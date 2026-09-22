import type { GeminiIssueReason } from "../gemini/error-classification";

export const COMMENT_CATEGORIES = [
  "GENERAL_REACTION",
  "FOLLOW_UP_REQUEST",
  "QUESTION",
  "FACT_OR_COMPLAINT",
  "AD_OR_UNRELATED",
] as const;

export type CommentCategory = (typeof COMMENT_CATEGORIES)[number];

export const PROCESSING_TIERS = [
  "AUTO_REPLY_CANDIDATE",
  "HUMAN_REVIEW",
  "NO_REPLY",
] as const;

export type ProcessingTier = (typeof PROCESSING_TIERS)[number];

export function isCommentCategory(value: unknown): value is CommentCategory {
  return (
    typeof value === "string" &&
    (COMMENT_CATEGORIES as readonly string[]).includes(value)
  );
}

export function isProcessingTier(value: unknown): value is ProcessingTier {
  return (
    typeof value === "string" &&
    (PROCESSING_TIERS as readonly string[]).includes(value)
  );
}

/** A single top-level comment as read from commentThreads.list, kept in memory only. */
export interface FetchedComment {
  /** commentThreads.list item id — the thread, not the comment. */
  threadId: string;
  /** commentThreads.list item.snippet.topLevelComment.id — the top-level comment. */
  topLevelCommentId: string;
  /**
   * The comment body as plain text. Named `text`, not `textOriginal`, because
   * it normally comes from snippet.textDisplay — textOriginal is returned only
   * for the reader's own comments. See parseCommentThreads in
   * src/lib/youtube/schema.ts.
   */
  text: string;
  publishedAt: string;
  /** Read in memory only; absent authors are never scheduled. */
  authorChannelId?: string | null;
}

export interface ClassificationResult {
  category: CommentCategory | "UNKNOWN";
  tier: ProcessingTier;
  reason: string;
  /** True when the AI or a local rule flagged mixed/ambiguous/sensitive content. */
  forcedHumanReview: boolean;
}

export interface DraftResult {
  draft: string | null;
}

export interface ProgramCheckResult {
  passed: boolean;
  failures: string[];
}

export interface AiContextCheckResult {
  passed: boolean;
  reason: string;
}

export interface DraftVerification {
  aiCheck: AiContextCheckResult;
  programCheck: ProgramCheckResult;
  passed: boolean;
}

/** Which pipeline stage the Gemini call failed at. */
export const GEMINI_ISSUE_STAGES = ["classification", "draft", "context_check"] as const;
export type GeminiIssueStage = (typeof GEMINI_ISSUE_STAGES)[number];

/**
 * Set on a CommentReviewItem whenever a Gemini call it depended on failed —
 * never set for a local guard (blank text, personal-info pattern, program
 * check) rejecting the same item, since those are not Gemini outages.
 */
export interface GeminiIssue {
  stage: GeminiIssueStage;
  reason: GeminiIssueReason;
}

export interface CommentReviewItem {
  threadId: string;
  topLevelCommentId: string;
  text: string;
  publishedAt: string;
  classification: ClassificationResult;
  draft: string | null;
  verification: DraftVerification | null;
  geminiIssue: GeminiIssue | null;
}
