import { readFileSync } from "node:fs";
import { CommentsListResult, VideoLookup, YoutubeClient } from "./types";
import { YoutubeSchemaError, parseCommentThreads, parseMyChannelId, parseVideoLookup } from "./schema";
import {
  YoutubeAuthError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeInvalidResponseError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
} from "./errors";

/**
 * Read-only YouTube Data API v3 client. Every request below uses GET.
 * There is no write method on YoutubeClient and none is added here —
 * comments.insert / commentThreads.insert / videos.update are never called.
 *
 * Credentials come from two files the server reads directly, not from
 * raw secret values copied into env vars: an OAuth Desktop client JSON
 * (shared, read-only reuse of the chapter 18 Cloud project) and a separate
 * chapter-19 comment-read token file written by
 * scripts/setup-youtube-comment-read-oauth.mjs. Neither file's contents are
 * ever logged.
 */

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// The YouTube Data API v3 Discovery document lists youtube.force-ssl as the
// only scope that authorizes commentThreads.list (and comments.list) — it
// does NOT list youtube.readonly or the plain youtube scope for either
// method, despite both being commonly assumed to cover all read calls.
// (Provenance: Google YouTube Data API v3 Discovery document, checked
// 2026-09-14, after a real commentThreads.list call on an owned public
// video returned HTTP 403 insufficientPermissions for a youtube.readonly
// token.) Google's consent screen labels youtube.force-ssl broadly ("YouTube
// 데이터 관리"), but this app grants itself no more than that label implies:
// it only ever calls channels.list / videos.list / commentThreads.list (all
// GET) and has no comments.insert / update / delete or other write method —
// see createRealYoutubeClient below.
const YOUTUBE_COMMENT_READ_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

// This app accepts ONLY youtube.force-ssl, exactly one scope, no other YouTube
// scope mixed in (youtube.readonly, youtube, youtube.upload, even if force-ssl
// is also present) — the runtime loader enforces this before any network call
// to prevent silently granting write access the fixed source never uses.
const ALLOWED_READ_SCOPES: readonly string[] = [YOUTUBE_COMMENT_READ_SCOPE];
const ALLOWED_SCOPES_COUNT = 1;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// In-memory only — never written to disk, a database, or a log.
let cachedToken: CachedToken | null = null;

function loadClientCredentials(): { clientId: string; clientSecret: string } {
  const path = process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH;
  if (!path) {
    throw new YoutubeConfigMissingError("YOUTUBE_OAUTH_CLIENT_JSON_PATH is not set on the server.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new YoutubeCredentialFileError("OAuth client JSON 파일을 읽거나 파싱할 수 없습니다.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new YoutubeCredentialFileError("OAuth client JSON 파일 형식이 올바르지 않습니다.");
  }
  const record = raw as Record<string, unknown>;
  const inner = record.installed;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new YoutubeCredentialFileError(
      "OAuth client JSON 파일이 Desktop(installed) 클라이언트 형식이 아닙니다. Cloud Console에서 '데스크톱 앱' 유형으로 만든 client_secret*.json을 사용하세요.",
    );
  }
  const innerRecord = inner as Record<string, unknown>;
  const clientId = innerRecord.client_id;
  const clientSecret = innerRecord.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new YoutubeCredentialFileError("OAuth client JSON 파일에 client_id/client_secret이 없습니다.");
  }
  return { clientId, clientSecret };
}

function loadRefreshToken(): string {
  const path = process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH;
  if (!path) {
    throw new YoutubeConfigMissingError("YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH is not set on the server.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new YoutubeCredentialFileError("댓글 읽기용 Token 파일을 읽거나 파싱할 수 없습니다.");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new YoutubeCredentialFileError("댓글 읽기용 Token 파일 형식이 올바르지 않습니다.");
  }
  const record = raw as Record<string, unknown>;

  const refreshToken = record.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new YoutubeCredentialFileError("댓글 읽기용 Token 파일에 refresh_token이 없습니다.");
  }

  // The file's shape is trusted only after this check — a token saved
  // under a scope this app doesn't recognize (or edited by hand) must
  // never be used to call the YouTube API, even though refresh_token
  // alone would work. This rejects chapter 18's status-change token
  // (scope youtube) and youtube.readonly just as firmly as youtube.upload —
  // per the current Discovery contract, none of the three authorizes
  // commentThreads.list. It also rejects force-ssl mixed with any other
  // scope (force-ssl+readonly, force-ssl+youtube, force-ssl+upload,
  // force-ssl+openid) — the granted scope must be exactly force-ssl alone.
  const grantedScopes = extractGrantedScopes(record);
  const hasExactlyAllowedScope =
    grantedScopes.length === ALLOWED_SCOPES_COUNT &&
    grantedScopes.every((grantedScope) => ALLOWED_READ_SCOPES.includes(grantedScope));
  if (!hasExactlyAllowedScope) {
    throw new YoutubeScopeInsufficientError(
      `댓글 읽기용 Token 파일에 필요한 범위(${YOUTUBE_COMMENT_READ_SCOPE}) 하나만 정확히 있어야 합니다. npm run setup:youtube-comment-read를 실행해 이 범위로 새 Token을 발급하세요.`,
    );
  }

  return refreshToken;
}

// Google's two OAuth token JSON shapes: a singular space-delimited "scope"
// string (this app's own setup script, and many OAuth libraries), or the
// "scopes" array that Python's Credentials.to_json produces. Only one shape
// is trusted per file — if "scope" is a string it wins, otherwise "scopes"
// must be a well-formed string array. Anything else (wrong type, non-string
// array entries) fails closed rather than silently granting access.
function extractGrantedScopes(record: Record<string, unknown>): string[] {
  const { scope, scopes } = record;
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }
  if (Array.isArray(scopes)) {
    const result: string[] = [];
    for (const entry of scopes) {
      if (typeof entry !== "string") {
        throw new YoutubeCredentialFileError("댓글 읽기용 Token 파일의 scopes 배열에 문자열이 아닌 값이 있습니다.");
      }
      if (entry.length > 0) {
        result.push(entry);
      }
    }
    return result;
  }
  return [];
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = loadClientCredentials();
  const refreshToken = loadRefreshToken();

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    // The token endpoint's error body (e.g. {"error":"invalid_grant",
    // "error_description": "..."}) is never read here — it can echo back
    // request details, and the status code alone is enough to classify
    // the failure safely. 400/401/403 (invalid_grant, invalid_client,
    // unauthorized_client, etc. all arrive as one of these) mean the
    // refresh token or client credentials are no longer valid; 429 means
    // the token endpoint itself is rate-limiting this app.
    if (response.status === 429) {
      throw new YoutubeQuotaExceededError(`Token refresh rate-limited with status ${response.status}`);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new YoutubeAuthError(`Token refresh failed with status ${response.status}`);
    }
    throw new Error(`Token refresh failed with status ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("Token 갱신 응답을 JSON으로 읽지 못했습니다.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답 형식이 올바르지 않습니다.");
  }
  const record = body as Record<string, unknown>;

  // A response with no access_token must never fall through to
  // `Authorization: Bearer undefined` — fail closed instead.
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답에 access_token이 없습니다.");
  }

  const expiresIn = record.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답에 유효한 expires_in이 없습니다.");
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}

async function authedGet(path: string, params: Record<string, string>): Promise<Response> {
  const accessToken = await getAccessToken();
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

interface YoutubeApiError {
  error?: { errors?: Array<{ reason?: string }>; code?: number };
}

async function readApiErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as YoutubeApiError;
    return body.error?.errors?.[0]?.reason ?? null;
  } catch {
    return null;
  }
}

// Shared by channels.list and videos.list: both are simple GET lookups with
// no result kind of their own (unlike commentThreads.list, which has a
// reader-facing "forbidden" outcome distinct from auth_error). The safe
// `reason` from the API body is inspected only to tell a quota failure
// apart from an auth/permission failure — the reason detail and response
// body are never read again after this and never reach the caller.
async function throwForFailedListResponse(response: Response, endpointLabel: string): Promise<never> {
  const reason = await readApiErrorReason(response);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    throw new YoutubeQuotaExceededError(`${endpointLabel} quota exceeded (status ${response.status})`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new YoutubeAuthError(`${endpointLabel} failed with status ${response.status}`);
  }
  throw new Error(`${endpointLabel} failed with status ${response.status}`);
}

async function getMyChannelId(): Promise<string> {
  const response = await authedGet("/channels", { part: "id", mine: "true" });
  if (!response.ok) {
    return throwForFailedListResponse(response, "channels.list");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("channels.list 응답을 JSON으로 읽지 못했습니다.");
  }
  return parseMyChannelId(body);
}

async function getVideo(videoId: string): Promise<VideoLookup> {
  const response = await authedGet("/videos", {
    part: "snippet,status",
    id: videoId,
  });
  if (!response.ok) {
    return throwForFailedListResponse(response, "videos.list");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("videos.list 응답을 JSON으로 읽지 못했습니다.");
  }
  return parseVideoLookup(body);
}

async function listTopLevelComments(videoId: string): Promise<CommentsListResult> {
  let response: Response;
  try {
    response = await authedGet("/commentThreads", {
      part: "snippet",
      videoId,
      order: "time",
      maxResults: "20",
      textFormat: "plainText",
    });
  } catch (error) {
    // The access token is fetched inside authedGet, so a local setup problem
    // (unset env var, unreadable credential file, a token whose granted scope
    // is not exactly force-ssl, a malformed refresh response) surfaces here
    // too. Reporting those as "통신 실패" would send the reader to check their
    // internet connection for a problem that is in their own configuration,
    // so they are rethrown for the route to classify by type. Anything else
    // coming out of fetch really is a transport failure.
    if (
      error instanceof YoutubeConfigMissingError ||
      error instanceof YoutubeCredentialFileError ||
      error instanceof YoutubeScopeInsufficientError ||
      error instanceof YoutubeInvalidResponseError
    ) {
      throw error;
    }
    if (error instanceof YoutubeAuthError) {
      return { kind: "auth_error" };
    }
    if (error instanceof YoutubeQuotaExceededError) {
      return { kind: "quota_exceeded" };
    }
    return {
      kind: "network_error",
      message: error instanceof Error ? error.message : "unknown network error",
    };
  }

  if (!response.ok) {
    const reason = await readApiErrorReason(response);
    if (reason === "commentsDisabled") {
      return { kind: "disabled" };
    }
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
      return { kind: "quota_exceeded" };
    }
    // The video is gone or no longer visible — it may have been deleted or
    // switched to private between the ownership check and this call.
    if (response.status === 404) {
      return { kind: "video_not_found" };
    }
    if (response.status === 401) {
      return { kind: "auth_error" };
    }
    if (response.status === 403) {
      return { kind: "forbidden" };
    }
    return { kind: "network_error", message: `HTTP ${response.status}${reason ? ` (${reason})` : ""}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "invalid_response", message: "commentThreads.list 응답을 JSON으로 읽지 못했습니다." };
  }

  let parsed;
  try {
    parsed = parseCommentThreads(body);
  } catch (error) {
    if (error instanceof YoutubeSchemaError) {
      return { kind: "invalid_response", message: error.message };
    }
    throw error;
  }

  if (parsed.comments.length === 0) {
    // Items came back but not one of them could be read: that is a response
    // this app failed to understand, not "이 영상에는 댓글이 0개".
    if (parsed.skippedCount > 0) {
      return {
        kind: "invalid_response",
        message: `commentThreads.list 항목 ${parsed.skippedCount}개를 모두 읽지 못했습니다.`,
      };
    }
    return { kind: "empty" };
  }

  return {
    kind: "ok",
    comments: parsed.comments,
    skippedCount: parsed.skippedCount,
    nextPageToken: parsed.nextPageToken,
  };
}

export function createRealYoutubeClient(): YoutubeClient {
  return { getMyChannelId, getVideo, listTopLevelComments };
}
