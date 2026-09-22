import { authedGet, authedPost, readApiErrorReason, SendWindowExpiredError } from "./api";
import {
  YoutubeAuthError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeInvalidResponseError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
} from "./errors";
import {
  InsertReplyResult,
  ListRepliesResult,
  ReplyAuthorship,
  ReplyClient,
} from "./reply-types";

/**
 * The one and only place this project writes to YouTube.
 *
 * insertReply calls comments.insert once, with a parentId that must be an
 * existing top-level comment and a text the server generated and checked
 * itself. There is no update, delete, moderation-status, mark-as-spam,
 * thread-insert, video-update, or rating call here or anywhere else —
 * src/app/bounded-write-surface.test.ts re-asserts that statically on every
 * test run, and also asserts that authedPost is imported by this file alone.
 *
 * listReplies walks EVERY page of comments.list for one parent comment. It
 * exists for a single purpose: after a send whose result could not be
 * observed, this is the only way to learn whether the reply actually landed.
 * Because a wrong "no reply here" would cause a duplicate reply, a run that
 * cannot reach the last page reports page_limit_reached rather than an
 * incomplete "ok".
 */

/** comments.list allows up to 100 items per page. */
const REPLIES_PAGE_SIZE = 100;

/**
 * A hard stop on pagination. 100 pages x 100 replies is far beyond any
 * realistic reply count on one comment; hitting it means something is wrong,
 * and the caller is told the walk was inconclusive instead of being handed a
 * partial list that looks complete.
 */
const MAX_REPLY_PAGES = 100;

function classifyInsertFailure(status: number, reason: string | null): InsertReplyResult {
  if (status === 408 || status === 504) {
    return { kind: "result_unknown", reason: "connection_interrupted" };
  }
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    return { kind: "rejected", reason: "quota_exceeded" };
  }
  if (status === 401) {
    return { kind: "rejected", reason: "auth_error" };
  }
  if (status === 403) {
    return { kind: "rejected", reason: "forbidden" };
  }
  if (status === 404) {
    return { kind: "rejected", reason: "parent_not_found" };
  }
  if (status >= 400 && status < 500) {
    return { kind: "rejected", reason: "invalid_request" };
  }
  // 5xx: YouTube may have applied the insert before failing to answer.
  return { kind: "result_unknown", reason: "server_error" };
}

/**
 * Everything authedPost can throw before it ever builds a request: a missing
 * env var, an unreadable credential file, a token with the wrong scope, or a
 * refresh Google refused. All of these happen while getting the access token,
 * so no request left this machine and the reply definitely does not exist —
 * which makes them safe to report as "rejected", refunding the daily slot.
 *
 * Classification is by type, never by message: these messages can name a local
 * file path. Anything NOT in this list came from the fetch itself, and a fetch
 * that threw may still have delivered the request.
 */
function isPreflightCredentialFailure(error: unknown): boolean {
  return (
    error instanceof YoutubeConfigMissingError ||
    error instanceof YoutubeCredentialFileError ||
    error instanceof YoutubeScopeInsufficientError ||
    error instanceof YoutubeAuthError ||
    error instanceof YoutubeQuotaExceededError ||
    error instanceof YoutubeInvalidResponseError
  );
}

async function insertReply(input: {
  parentCommentId: string;
  text: string;
  expectedSendDay?: string;
}): Promise<InsertReplyResult> {
  let response: Response;
  try {
    response = await authedPost(
      "/comments",
      { part: "snippet" },
      { snippet: { parentId: input.parentCommentId, textOriginal: input.text } },
      input.expectedSendDay,
    );
  } catch (error) {
    if (error instanceof SendWindowExpiredError) return { kind: "rejected", reason: "send_window_expired" };
    if (isPreflightCredentialFailure(error)) {
      return { kind: "rejected", reason: "credentials_unavailable" };
    }
    // The request was in flight when it broke. It may have reached YouTube.
    // The thrown error's message is deliberately not read or forwarded.
    return { kind: "result_unknown", reason: "connection_interrupted" };
  }

  if (!response.ok) {
    const reason = await readApiErrorReason(response);
    return classifyInsertFailure(response.status, reason);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // A 2xx we cannot read means the reply was very likely created. Treating
    // this as a failure would risk a duplicate on the next run.
    return { kind: "result_unknown", reason: "unreadable_success_response" };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "result_unknown", reason: "unreadable_success_response" };
  }
  const id = (body as Record<string, unknown>).id;
  if (typeof id !== "string" || id.length === 0) {
    return { kind: "result_unknown", reason: "unreadable_success_response" };
  }

  return { kind: "ok", replyCommentId: id };
}

function classifyListFailure(status: number, reason: string | null): ListRepliesResult {
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    return { kind: "quota_exceeded" };
  }
  if (status === 401) {
    return { kind: "auth_error" };
  }
  if (status === 403) {
    return { kind: "forbidden" };
  }
  if (status === 404) {
    return { kind: "parent_not_found" };
  }
  return { kind: "network_error" };
}

function parseReplyPage(
  body: unknown,
): { replies: ReplyAuthorship[]; nextPageToken: string | null } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const items = record.items;
  if (!Array.isArray(items)) {
    return null;
  }

  const replies: ReplyAuthorship[] = [];
  for (const raw of items) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      return null;
    }
    const item = raw as Record<string, unknown>;
    const id = item.id;
    if (typeof id !== "string" || id.length === 0) {
      return null;
    }
    const snippet = item.snippet as Record<string, unknown> | undefined;
    const text = snippet && typeof snippet.textDisplay === "string" ? snippet.textDisplay : null;
    replies.push({ replyCommentId: id, authorChannelId: readAuthorChannelId(item.snippet), text });
  }

  const nextPageToken = record.nextPageToken;
  return { replies, nextPageToken: typeof nextPageToken === "string" && nextPageToken.length > 0 ? nextPageToken : null };
}

/**
 * snippet.authorChannelId is an object ({"value": "UC..."}) in the YouTube
 * Data API, not a bare string. A shape this app does not recognize yields
 * null rather than a guess — the caller then treats the reply as "not
 * provably mine", which is the safe direction.
 */
function readAuthorChannelId(snippet: unknown): string | null {
  if (typeof snippet !== "object" || snippet === null || Array.isArray(snippet)) {
    return null;
  }
  const authorChannelId = (snippet as Record<string, unknown>).authorChannelId;
  if (typeof authorChannelId !== "object" || authorChannelId === null || Array.isArray(authorChannelId)) {
    return null;
  }
  const value = (authorChannelId as Record<string, unknown>).value;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function listReplies(parentCommentId: string): Promise<ListRepliesResult> {
  const replies: ReplyAuthorship[] = [];
  const seenPageTokens = new Set<string>();
  let pageToken: string | null = null;
  let pageCount = 0;

  while (pageCount < MAX_REPLY_PAGES) {
    const params: Record<string, string> = {
      part: "snippet",
      parentId: parentCommentId,
      maxResults: String(REPLIES_PAGE_SIZE),
      textFormat: "plainText",
    };
    if (pageToken !== null) {
      params.pageToken = pageToken;
    }

    let response: Response;
    try {
      response = await authedGet("/comments", params);
    } catch (error) {
      // Either way the walk is inconclusive, so the caller cannot conclude
      // "no reply is there" — but naming the cause makes the status readable.
      return isPreflightCredentialFailure(error) ? { kind: "auth_error" } : { kind: "network_error" };
    }
    pageCount += 1;

    if (!response.ok) {
      const reason = await readApiErrorReason(response);
      return classifyListFailure(response.status, reason);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "invalid_response" };
    }

    const parsed = parseReplyPage(body);
    if (parsed === null) {
      return { kind: "invalid_response" };
    }
    replies.push(...parsed.replies);

    if (parsed.nextPageToken === null) {
      return { kind: "ok", replies, pageCount };
    }
    // A server that hands back a token it already gave us would otherwise
    // loop forever; stop and report the walk as inconclusive.
    if (seenPageTokens.has(parsed.nextPageToken)) {
      return { kind: "page_limit_reached", replies, pageCount };
    }
    seenPageTokens.add(parsed.nextPageToken);
    pageToken = parsed.nextPageToken;
  }

  return { kind: "page_limit_reached", replies, pageCount };
}

export function createRealReplyClient(): ReplyClient {
  return { insertReply, listReplies };
}
