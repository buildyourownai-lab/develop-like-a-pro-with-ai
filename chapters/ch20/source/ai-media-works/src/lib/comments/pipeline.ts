import { classifyGeminiError } from "../gemini/error-classification";
import { GeminiSchemaError } from "../gemini/schema";
import { GeminiClient } from "../gemini/types";
import { categoryLabel } from "./category-label";
import { runProgramCheck } from "./draft-policy";
import {
  isBlank,
  isOverAutoReplyLength,
  looksLikePersonalInfo,
} from "./pre-checks";
import { tierForCategory } from "./tier-policy";
import {
  ClassificationResult,
  CommentReviewItem,
  FetchedComment,
  GeminiIssue,
  isCommentCategory,
} from "./types";

function unknown(reason: string): ClassificationResult {
  return { category: "UNKNOWN", tier: "HUMAN_REVIEW", reason, forcedHumanReview: true };
}

interface ClassifyResult {
  classification: ClassificationResult;
  /** null for a local guard (blank/personal-info) — those are not Gemini failures. */
  geminiIssue: GeminiIssue | null;
}

async function classify(text: string, gemini: GeminiClient): Promise<ClassifyResult> {
  if (isBlank(text)) {
    return {
      classification: unknown("빈 댓글은 자동 처리하지 않고 사람 확인으로 남깁니다."),
      geminiIssue: null,
    };
  }
  if (looksLikePersonalInfo(text)) {
    return {
      classification: unknown(
        "개인정보로 보이는 내용이 있어 AI 처리에서 제외하고 사람 확인으로 남깁니다.",
      ),
      geminiIssue: null,
    };
  }

  let category: string;
  let mixedSignals: boolean;
  try {
    const result = await gemini.classifyComment(text);
    category = result.category;
    mixedSignals = result.mixedSignals;
  } catch (error) {
    return {
      classification: unknown("분류 호출이 실패해 사람 확인으로 남깁니다."),
      geminiIssue: { stage: "classification", reason: classifyGeminiError(error) },
    };
  }

  if (!isCommentCategory(category)) {
    return {
      classification: unknown("AI가 정해진 다섯 종류에 없는 값을 반환해 사람 확인으로 남깁니다."),
      geminiIssue: { stage: "classification", reason: "invalid_response" },
    };
  }

  let tier = tierForCategory(category);
  let forcedHumanReview = false;
  const reasonParts = [`분류: ${categoryLabel(category)}`];

  if (mixedSignals && tier === "AUTO_REPLY_CANDIDATE") {
    tier = "HUMAN_REVIEW";
    forcedHumanReview = true;
    reasonParts.push("혼합·모호한 신호로 사람 확인으로 전환했습니다.");
  }
  if (tier === "AUTO_REPLY_CANDIDATE" && isOverAutoReplyLength(text)) {
    tier = "HUMAN_REVIEW";
    forcedHumanReview = true;
    reasonParts.push("댓글이 너무 길어 사람 확인으로 전환했습니다.");
  }

  return {
    classification: { category, tier, reason: reasonParts.join(" "), forcedHumanReview },
    geminiIssue: null,
  };
}

/**
 * Classifies one comment, and — only when it lands in the auto-reply tier —
 * drafts a reply and runs the AI context check and the program check on it.
 * A verification failure downgrades the tier to human review but keeps the
 * draft and both check results visible for the local preview.
 */
export async function reviewComment(
  comment: FetchedComment,
  gemini: GeminiClient,
): Promise<CommentReviewItem> {
  const { classification, geminiIssue } = await classify(comment.text, gemini);

  const base: CommentReviewItem = {
    threadId: comment.threadId,
    topLevelCommentId: comment.topLevelCommentId,
    text: comment.text,
    publishedAt: comment.publishedAt,
    classification,
    draft: null,
    verification: null,
    geminiIssue,
  };

  if (classification.tier !== "AUTO_REPLY_CANDIDATE" || !isCommentCategory(classification.category)) {
    return base;
  }

  let draft: string;
  try {
    const draftResult = await gemini.generateDraft(
      comment.text,
      classification.category,
    );
    draft = draftResult.draft.trim();
    if (draft.length === 0) throw new GeminiSchemaError("draft 값이 비어 있는 문자열입니다.");
  } catch (error) {
    return {
      ...base,
      classification: {
        ...classification,
        tier: "HUMAN_REVIEW",
        forcedHumanReview: true,
        reason: `${classification.reason} 초안 생성이 실패해 사람 확인으로 전환했습니다.`,
      },
      geminiIssue: { stage: "draft", reason: classifyGeminiError(error) },
    };
  }

  const programCheck = runProgramCheck(draft, comment.text);

  let aiCheck: { passed: boolean; reason: string };
  let contextIssue: CommentReviewItem["geminiIssue"] = null;
  try {
    aiCheck = await gemini.checkDraftContext(comment.text, draft);
  } catch (error) {
    aiCheck = { passed: false, reason: "AI 검사 호출이 실패했습니다." };
    contextIssue = { stage: "context_check", reason: classifyGeminiError(error) };
  }

  const verificationPassed = programCheck.passed && aiCheck.passed;

  return {
    ...base,
    draft,
    verification: { aiCheck, programCheck, passed: verificationPassed },
    classification: verificationPassed
      ? classification
      : {
          ...classification,
          tier: "HUMAN_REVIEW",
          forcedHumanReview: true,
          reason: `${classification.reason} 초안 검사를 통과하지 못해 사람 확인으로 전환했습니다.`,
        },
    geminiIssue: contextIssue,
  };
}
