import { jsonResponse } from "@/lib/http";
import { blockPreviewInProduction } from "@/lib/autoreply/runtime-guard";
import { reviewComment } from "@/lib/comments/pipeline";
import { validateReviewRequest } from "@/lib/comments/request-validation";
import { GEMINI_ISSUE_MESSAGE } from "@/lib/gemini/error-classification";
import { createRealGeminiClient, hasGeminiConfig } from "@/lib/gemini/real-client";
import { mapWithConcurrencyLimit } from "@/lib/concurrency";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Caps how many Gemini calls this route fires at once, independent of the 1-20 batch size cap. */
const REVIEW_CONCURRENCY_LIMIT = 5;

/**
 * Classifies each comment, drafts a reply only for auto-reply-eligible
 * comments, and runs the AI context check and the program check on that
 * draft. Nothing here writes to YouTube or persists comment text anywhere —
 * the response is the only place this data exists after the request ends.
 *
 * A Gemini failure on any one comment never raises here — reviewComment()
 * fails that comment closed to HUMAN_REVIEW and records a geminiIssue
 * instead. This route's job is only to reflect that up: `status: "ok"`
 * must mean every item finished with no Gemini issue, so a batch where any
 * item was downgraded because of one comes back as `status: "partial"`
 * instead — never "ok" — so the UI cannot mistake a downgraded batch for a
 * fully successful one. A missing GEMINI_API_KEY/GEMINI_MODEL is checked
 * before any comment is processed, since in that case not one item could
 * ever succeed.
 *
 * The request body is comment text and the response is a draft written from it,
 * so this route is closed in production — see
 * src/lib/autoreply/runtime-guard.ts. Chapter 20's automation calls
 * reviewComment() directly on the server instead, and never returns the text.
 */
export async function POST(request: Request) {
  const blocked = blockPreviewInProduction();
  if (blocked !== null) return blocked;

  let comments: unknown;
  try {
    const body = await request.json();
    comments = (body as { comments?: unknown }).comments;
  } catch {
    return jsonResponse({ status: "error", message: "요청 본문을 읽을 수 없습니다." }, 400);
  }

  const validation = validateReviewRequest(comments);
  if (!validation.ok) {
    return jsonResponse({ status: "error", message: validation.message }, 400);
  }

  if (!hasGeminiConfig()) {
    return jsonResponse(
      { status: "error", reason: "config_missing", message: GEMINI_ISSUE_MESSAGE.config_missing },
      500,
    );
  }

  try {
    const gemini = createRealGeminiClient();
    const items = await mapWithConcurrencyLimit(
      validation.comments,
      REVIEW_CONCURRENCY_LIMIT,
      (comment) => reviewComment(comment, gemini),
    );

    const hasGeminiIssue = items.some((item) => item.geminiIssue !== null);

    return jsonResponse({ status: hasGeminiIssue ? "partial" : "ok", items });
  } catch {
    return jsonResponse(
      { status: "error", message: "분류·초안 생성 중 예상하지 못한 오류가 발생했습니다." },
      500,
    );
  }
}
