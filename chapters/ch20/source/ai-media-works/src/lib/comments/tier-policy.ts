import { CommentCategory, ProcessingTier } from "./types";

/**
 * The server, not the model, decides the tier for a known category.
 * Any AI-supplied tier or confidence score is ignored on purpose —
 * a category outside this table always falls back to human review.
 */
const CATEGORY_TIER: Record<CommentCategory, ProcessingTier> = {
  GENERAL_REACTION: "AUTO_REPLY_CANDIDATE",
  FOLLOW_UP_REQUEST: "AUTO_REPLY_CANDIDATE",
  QUESTION: "HUMAN_REVIEW",
  FACT_OR_COMPLAINT: "HUMAN_REVIEW",
  AD_OR_UNRELATED: "NO_REPLY",
};

export function tierForCategory(category: CommentCategory): ProcessingTier {
  return CATEGORY_TIER[category];
}

export function isAutoReplyEligibleCategory(category: CommentCategory): boolean {
  return tierForCategory(category) === "AUTO_REPLY_CANDIDATE";
}
