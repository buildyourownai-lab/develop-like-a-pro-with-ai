/**
 * The chapter 20 write/verify surface, kept in its own type file so the
 * read-only YoutubeClient contract in ./types.ts stays untouched.
 */

/**
 * The outcome of one comments.insert call, split along the only line that
 * matters for safety: whether the reply may already exist on YouTube.
 *
 * - "ok"             — YouTube returned the created reply's id. Definitely sent.
 * - "rejected"       — YouTube refused before creating anything (4xx with a
 *                      readable error body). Definitely NOT sent, so the
 *                      reserved daily-quota slot can be safely refunded.
 * - "result_unknown" — the request may or may not have been applied: the
 *                      connection broke, the server returned 5xx, or a 2xx
 *                      body could not be read. The reply might exist. Nothing
 *                      is refunded and automation stops; only a later
 *                      comments.list check over the parent comment's full
 *                      reply pages can settle it.
 */
export type InsertReplyResult =
  | { kind: "ok"; replyCommentId: string }
  | { kind: "rejected"; reason: InsertRejectedReason }
  | { kind: "result_unknown"; reason: ResultUnknownReason };

export const INSERT_REJECTED_REASONS = [
  "send_window_expired",
  "auth_error",
  "quota_exceeded",
  "forbidden",
  "parent_not_found",
  "invalid_request",
  /**
   * The access token could not be obtained at all — no credential file, a
   * token whose scope is wrong, or a refresh Google refused. This counts as
   * "definitely not sent" because it happens before the request is built.
   */
  "credentials_unavailable",
] as const;
export type InsertRejectedReason = (typeof INSERT_REJECTED_REASONS)[number];

export const RESULT_UNKNOWN_REASONS = [
  "connection_interrupted",
  "server_error",
  "unreadable_success_response",
] as const;
export type ResultUnknownReason = (typeof RESULT_UNKNOWN_REASONS)[number];

/** One reply as read back from comments.list — held in memory only. */
export interface ReplyAuthorship {
  replyCommentId: string;
  /** snippet.authorChannelId.value, or null when the API did not include it. */
  authorChannelId: string | null;
  /** Read back only in memory for the recent-repeat check. */
  text?: string | null;
}

/**
 * The outcome of walking every page of comments.list for one parent comment.
 * "ok" is the only kind a caller may treat as conclusive evidence about
 * whether a reply exists — "page_limit_reached" and the failure kinds must
 * never be read as "no reply is there".
 */
export type ListRepliesResult =
  | { kind: "ok"; replies: ReplyAuthorship[]; pageCount: number }
  | { kind: "page_limit_reached"; replies: ReplyAuthorship[]; pageCount: number }
  | { kind: "auth_error" }
  | { kind: "quota_exceeded" }
  | { kind: "forbidden" }
  | { kind: "parent_not_found" }
  | { kind: "invalid_response" }
  | { kind: "network_error" };

export interface ReplyClient {
  /**
   * comments.insert — posts one reply under one existing top-level comment.
   * This is the only write method in this project.
   */
  insertReply(input: { parentCommentId: string; text: string; expectedSendDay?: string }): Promise<InsertReplyResult>;
  /**
   * comments.list over EVERY page of one parent comment's replies. Used for
   * pre-send checks and to inspect an unknown result.
   */
  listReplies(parentCommentId: string): Promise<ListRepliesResult>;
}
