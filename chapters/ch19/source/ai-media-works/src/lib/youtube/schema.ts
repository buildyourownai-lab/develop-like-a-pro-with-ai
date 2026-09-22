import { FetchedComment } from "../comments/types";
import { YoutubeChannelNotFoundError, YoutubeVideoNotFoundError } from "./errors";
import { VideoLookup } from "./types";

/**
 * Thrown when a YouTube Data API response does not have the shape this app
 * expects. Routes catch this and turn it into an explicit, safe error
 * instead of letting a raw TypeError (e.g. "Cannot read properties of
 * undefined") reach the client as an uncaught 500.
 */
export class YoutubeSchemaError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new YoutubeSchemaError(`${context} 응답이 JSON 객체가 아닙니다.`);
  }
  return value;
}

export function parseMyChannelId(body: unknown): string {
  const record = asRecord(body, "channels.list");
  const items = record.items;
  if (!Array.isArray(items)) {
    throw new YoutubeSchemaError("channels.list 응답에 items 배열이 없습니다.");
  }
  // mine=true returning zero channels is a well-formed answer: the signed-in
  // Google account simply has no YouTube channel yet.
  if (items.length === 0) {
    throw new YoutubeChannelNotFoundError("channels.list 응답에 채널 항목이 없습니다.");
  }
  const first = asRecord(items[0], "channels.list item");
  const id = first.id;
  if (typeof id !== "string" || id.length === 0) {
    throw new YoutubeSchemaError("channels.list 응답에 유효한 채널 id가 없습니다.");
  }
  return id;
}

export function parseVideoLookup(body: unknown): VideoLookup {
  const record = asRecord(body, "videos.list");
  const items = record.items;
  if (!Array.isArray(items)) {
    throw new YoutubeSchemaError("videos.list 응답에 items 배열이 없습니다.");
  }
  // videos.list answers an unknown, deleted, or invisible video id with an
  // empty items array and HTTP 200 — a real outcome, not a broken response.
  if (items.length === 0) {
    throw new YoutubeVideoNotFoundError("videos.list 응답에 해당 영상이 없습니다.");
  }
  const item = asRecord(items[0], "videos.list item");
  const id = item.id;
  const snippet = asRecord(item.snippet, "videos.list item.snippet");
  const status = asRecord(item.status, "videos.list item.status");
  const { title, channelId, channelTitle } = snippet;
  const { privacyStatus } = status;

  if (
    typeof id !== "string" ||
    typeof title !== "string" ||
    typeof channelId !== "string" ||
    typeof channelTitle !== "string" ||
    typeof privacyStatus !== "string"
  ) {
    throw new YoutubeSchemaError("videos.list 응답 형식이 올바르지 않습니다.");
  }

  return {
    videoId: id,
    title,
    channelId,
    channelTitle,
    privacyStatus,
    // videos.list status does not directly expose a comments-enabled flag;
    // that is only observable by calling commentThreads.list.
    commentsEnabledHint: null,
  };
}

export interface ParsedCommentThreads {
  comments: FetchedComment[];
  /**
   * How many returned items this app could not read. Reported onward so a
   * partial read is never presented as a complete one.
   */
  skippedCount: number;
  nextPageToken: string | null;
}

/**
 * commentThreads.list carries the comment body in two fields, and the API
 * reference states that snippet.textOriginal "is only returned if the
 * authenticated user is the comment's author" — for every other viewer's
 * comment it is simply absent. So textDisplay is the field this app reads;
 * because the request sets textFormat=plainText, that value contains no HTML.
 * textOriginal is used only as a fallback, which is what arrives for the
 * reader's own comments.
 * (Provenance: YouTube Data API v3 Comments resource reference, checked
 * 2026-09-14, https://developers.google.com/youtube/v3/docs/comments)
 */
function parseCommentThreadItem(raw: unknown): FetchedComment | null {
  if (!isRecord(raw) || !isRecord(raw.snippet)) return null;
  const topLevelComment = raw.snippet.topLevelComment;
  if (!isRecord(topLevelComment) || !isRecord(topLevelComment.snippet)) return null;

  const threadId = raw.id;
  const commentId = topLevelComment.id;
  const { textDisplay, textOriginal, publishedAt } = topLevelComment.snippet;
  const text =
    typeof textDisplay === "string" ? textDisplay : typeof textOriginal === "string" ? textOriginal : null;

  if (
    typeof threadId !== "string" ||
    typeof commentId !== "string" ||
    text === null ||
    typeof publishedAt !== "string"
  ) {
    return null;
  }
  return { threadId, topLevelCommentId: commentId, text, publishedAt };
}

/**
 * A single unreadable item — a comment deleted between the request and the
 * response, or a shape this app does not recognize — must not throw away the
 * other 19 comments the reader asked for. Such items are skipped and counted;
 * only a response that is not a commentThreads.list response at all (no items
 * array) is rejected outright.
 */
export function parseCommentThreads(body: unknown): ParsedCommentThreads {
  const record = asRecord(body, "commentThreads.list");
  const items = record.items;
  if (!Array.isArray(items)) {
    throw new YoutubeSchemaError("commentThreads.list 응답에 items 배열이 없습니다.");
  }

  const comments: FetchedComment[] = [];
  for (const raw of items) {
    const comment = parseCommentThreadItem(raw);
    if (comment) {
      comments.push(comment);
    }
  }

  const nextPageToken = record.nextPageToken;
  return {
    comments,
    skippedCount: items.length - comments.length,
    nextPageToken: typeof nextPageToken === "string" ? nextPageToken : null,
  };
}
