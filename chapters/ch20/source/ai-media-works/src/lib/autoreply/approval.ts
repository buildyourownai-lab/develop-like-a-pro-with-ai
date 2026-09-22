import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { APPROVAL_TTL_SECONDS } from "./policy";

/**
 * What "approved" means, in a form the server can check.
 *
 * The problem this solves: a person reads one sentence on screen and presses
 * send. The text that then reaches YouTube must be exactly that sentence — not
 * a newly generated one, and not one the browser supplied. Both alternatives
 * fail:
 *
 *   - Trusting text from the request body would make approval mean "post
 *     whatever this page says", which is the one thing the whole chapter is
 *     built to avoid.
 *   - Re-generating the draft at send time would compare a person's approval
 *     against a different sentence every time, because a language model does
 *     not repeat itself. Every send would fail as "the text changed".
 *
 * So the server signs the sentence it showed, together with what it was a reply
 * to, and only accepts it back with that signature intact. The token carries:
 *
 *   videoId + commentId    — this approval belongs to that one comment
 *   commentDigest          — a hash of the comment text as it was when shown,
 *                            so an edited (or replaced) comment invalidates it
 *   activatedAt            — the target's baseline, so re-preparing a different
 *                            video invalidates every outstanding approval
 *   replyText              — the exact sentence, which is what gets sent
 *   exp                    — a short expiry, so a page left open goes stale
 *
 * Nothing here is persisted. The token lives in the browser between the preview
 * response and the send request, and the reply text exists in memory only.
 * The server still re-fetches the comment and re-runs both safety checks on the
 * approved text before sending; the signature stops tampering and staleness,
 * it does not replace the checks.
 */

const TOKEN_VERSION = "v1";

export interface ApprovalClaim {
  videoId: string;
  topLevelCommentId: string;
  /** Hash of the comment text as shown, never the text itself. */
  commentDigest: string;
  /** The target's baseline instant when the approval was issued. */
  activatedAt: string;
  /** The exact text that will be sent, if the token verifies. */
  replyText: string;
  /** Seconds since the epoch after which this approval is refused. */
  exp: number;
}

export const APPROVAL_ISSUES = [
  /** Not a token this app issued: wrong shape, or unreadable payload. */
  "malformed",
  /** The payload was changed after signing, or signed with another key. */
  "bad_signature",
  /** Approved too long ago. A fresh preview is required. */
  "expired",
  /** The token is for a different video than the request. */
  "video_mismatch",
  /** The token is for a different comment than the request. */
  "comment_mismatch",
  /** The comment's text is no longer what was on screen at approval time. */
  "comment_changed",
  /** The prepared target moved on since the approval was issued. */
  "target_changed",
  /**
   * The approved sentence itself did not pass the program check and the AI
   * context check when they were re-run against the comment as it is now.
   */
  "reply_not_verified",
] as const;
export type ApprovalIssue = (typeof APPROVAL_ISSUES)[number];

export type ApprovalVerdict =
  | { ok: true; claim: ApprovalClaim }
  | { ok: false; issue: ApprovalIssue };

/**
 * A stable hash of a comment's text. Used to detect an edit without keeping the
 * text: a digest cannot be turned back into what somebody wrote, and it is not
 * stored anywhere either — it only travels inside the token.
 */
export function digestText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("base64url");
}

/**
 * The key the approval signature is made with.
 *
 * In production the operator secret always exists (the routes refuse to run
 * without it), so approvals are signed with a value only the deployment knows.
 * Locally, where there may be no secret at all, a random key is generated once
 * per process: tokens then stop working after a restart, which is the safe
 * direction to fail.
 */
let processKey: Buffer | null = null;

function signingKey(): Buffer {
  const configured =
    process.env.AUTO_REPLY_APPROVAL_SECRET ?? process.env.AUTO_REPLY_OPERATOR_SECRET;
  if (configured !== undefined && configured.length > 0) {
    return Buffer.from(configured, "utf8");
  }
  if (processKey === null) {
    processKey = randomBytes(32);
  }
  return processKey;
}

function sign(payload: string): string {
  return createHmac("sha256", signingKey()).update(payload, "utf8").digest("base64url");
}

/** Builds the token the browser sends back with the approval. */
export function signApproval(claim: ApprovalClaim): string {
  const payload = Buffer.from(JSON.stringify(claim), "utf8").toString("base64url");
  return `${TOKEN_VERSION}.${payload}.${sign(payload)}`;
}

/** The expiry an approval issued now should carry. */
export function approvalExpiry(now: Date): number {
  return Math.floor(now.getTime() / 1000) + APPROVAL_TTL_SECONDS;
}

function signatureMatches(payload: string, provided: string): boolean {
  const expected = Buffer.from(sign(payload), "utf8");
  const given = Buffer.from(provided, "utf8");
  // Length is compared first because timingSafeEqual throws on a mismatch.
  return expected.length === given.length && timingSafeEqual(expected, given);
}

function parseClaim(value: unknown): ApprovalClaim | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const strings = ["videoId", "topLevelCommentId", "commentDigest", "activatedAt", "replyText"];
  for (const field of strings) {
    const held = row[field];
    if (typeof held !== "string" || held.length === 0) return null;
  }
  if (typeof row.exp !== "number" || !Number.isFinite(row.exp)) return null;
  return {
    videoId: row.videoId as string,
    topLevelCommentId: row.topLevelCommentId as string,
    commentDigest: row.commentDigest as string,
    activatedAt: row.activatedAt as string,
    replyText: row.replyText as string,
    exp: row.exp,
  };
}

/**
 * Checks a token against the request and against the world as it is now.
 *
 * Every branch refuses. There is no path where an unreadable, unsigned, stale,
 * or mismatched approval results in a send, and the checks are ordered so the
 * signature is verified before anything inside the payload is believed.
 */
export function verifyApproval(
  token: string,
  expected: {
    videoId: string;
    topLevelCommentId: string;
    commentDigest: string;
    activatedAt: string;
    now: Date;
  },
): ApprovalVerdict {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION) {
    return { ok: false, issue: "malformed" };
  }
  const [, payload, signature] = parts;
  if (payload === undefined || signature === undefined) {
    return { ok: false, issue: "malformed" };
  }
  if (!signatureMatches(payload, signature)) {
    return { ok: false, issue: "bad_signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return { ok: false, issue: "malformed" };
  }
  const claim = parseClaim(parsed);
  if (claim === null) {
    return { ok: false, issue: "malformed" };
  }

  if (claim.exp * 1000 <= expected.now.getTime()) {
    return { ok: false, issue: "expired" };
  }
  if (claim.videoId !== expected.videoId) {
    return { ok: false, issue: "video_mismatch" };
  }
  if (claim.topLevelCommentId !== expected.topLevelCommentId) {
    return { ok: false, issue: "comment_mismatch" };
  }
  if (claim.activatedAt !== expected.activatedAt) {
    return { ok: false, issue: "target_changed" };
  }
  if (claim.commentDigest !== expected.commentDigest) {
    return { ok: false, issue: "comment_changed" };
  }
  return { ok: true, claim };
}
