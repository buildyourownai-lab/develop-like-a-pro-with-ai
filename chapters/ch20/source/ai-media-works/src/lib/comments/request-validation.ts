import { FetchedComment } from "./types";

/** Matches the server-side cap enforced when comments are first read (commentThreads.list, maxResults=20). */
export const MAX_COMMENTS_PER_REQUEST = 20;
export const MIN_COMMENTS_PER_REQUEST = 1;
/** Generous upper bound — YouTube's own comment length limit is 10,000 characters. */
const MAX_TEXT_LENGTH = 10_000;
/** Real thread/comment IDs are short (~26 chars); this only exists to reject abusive payloads. */
const MAX_ID_LENGTH = 256;

export type ReviewRequestValidation =
  | { ok: true; comments: FetchedComment[] }
  | { ok: false; message: string };

function isValidPublishedAt(value: string): boolean {
  if (value.trim().length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function isFetchedCommentShape(value: unknown): value is FetchedComment {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.threadId === "string" &&
    typeof record.topLevelCommentId === "string" &&
    typeof record.text === "string" &&
    typeof record.publishedAt === "string"
  );
}

/**
 * Validates the /api/review request body: shape, the 1-20 batch size that
 * matches what commentThreads.list ever returns in one call, per-field
 * length limits, valid publishedAt timestamps, and no duplicate comment IDs
 * within the same batch. Returns a Korean message on the first failure —
 * this is a 400-boundary check, not a place to accumulate every error.
 */
export function validateReviewRequest(value: unknown): ReviewRequestValidation {
  if (!Array.isArray(value)) {
    return { ok: false, message: "comments 배열의 형식이 올바르지 않습니다." };
  }
  if (value.length < MIN_COMMENTS_PER_REQUEST) {
    return { ok: false, message: "comments 배열이 비어 있습니다. 최소 1개가 필요합니다." };
  }
  if (value.length > MAX_COMMENTS_PER_REQUEST) {
    return {
      ok: false,
      message: `comments 배열은 최대 ${MAX_COMMENTS_PER_REQUEST}개까지만 허용됩니다.`,
    };
  }

  const seenCommentIds = new Set<string>();
  for (const item of value) {
    if (!isFetchedCommentShape(item)) {
      return { ok: false, message: "comments 배열의 항목 형식이 올바르지 않습니다." };
    }
    if (
      item.threadId.length === 0 ||
      item.threadId.length > MAX_ID_LENGTH ||
      item.topLevelCommentId.length === 0 ||
      item.topLevelCommentId.length > MAX_ID_LENGTH
    ) {
      return { ok: false, message: "댓글 ID 길이가 올바르지 않습니다." };
    }
    if (item.text.length > MAX_TEXT_LENGTH) {
      return { ok: false, message: `댓글 본문이 ${MAX_TEXT_LENGTH}자를 넘습니다.` };
    }
    if (!isValidPublishedAt(item.publishedAt)) {
      return { ok: false, message: "publishedAt 값이 올바른 날짜 형식이 아닙니다." };
    }
    if (seenCommentIds.has(item.topLevelCommentId)) {
      return { ok: false, message: "같은 댓글 ID가 중복되어 있습니다." };
    }
    seenCommentIds.add(item.topLevelCommentId);
  }

  return { ok: true, comments: value };
}
