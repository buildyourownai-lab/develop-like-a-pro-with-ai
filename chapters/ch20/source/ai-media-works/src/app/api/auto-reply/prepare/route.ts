import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { PREVIEW_OUTCOME_MESSAGE, PREVIEW_OUTCOME_STATUS } from "@/lib/autoreply/outcome-message";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import {
  guardConfig,
  guardOperatorRequest,
  readStringFields,
  storeFailureResponse,
} from "@/lib/autoreply/route-guards";
import { prepareApprovedReply } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Draft and sign for an already prepared target; no target or schedule changes. */
export async function POST(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  const fields = await readStringFields(request, ["videoId", "topLevelCommentId"]);
  if (fields === null || fields.videoId === undefined || fields.topLevelCommentId === undefined) {
    return jsonResponse(
      { status: "error", message: "videoId와 topLevelCommentId가 필요합니다." },
      400,
    );
  }

  const { topLevelCommentId, videoId } = fields;
  try {
    const report = await withExecutionBudget(() => prepareApprovedReply(
      { videoId: videoId, topLevelCommentId: topLevelCommentId },
      createAutoReplyDeps(),
    ));
    return jsonResponse(
      {
        status: report.outcome === "ready" ? "ok" : "error",
        outcome: report.outcome,
        message: PREVIEW_OUTCOME_MESSAGE[report.outcome],
        // Always 0. Stated in the response because "showing a draft sends
        // nothing" is a promise a caller should be able to read back.
        sentCount: 0,
        targetCommentId: report.targetCommentId,
        // True only when this call stored the target for the first time. The
        // screen needs it to say "this video is now the reply target, from
        // now on" — and to explain why every comment already on the video
        // comes back not_eligible.
        targetPrepared: report.targetPrepared,
        // The one place a route returns generated text: this IS the thing a
        // person has to read before approving it. It is our own sentence, it is
        // about to be public on YouTube anyway, and it is never stored.
        draft: report.draft,
        // Hand this back to /api/auto-reply/send unchanged. It carries the
        // sentence above under a signature, and it goes stale on its own.
        approvalToken: report.approvalToken,
        skipped: report.skipped,
      },
      PREVIEW_OUTCOME_STATUS[report.outcome],
    );
  } catch (error) {
    return storeFailureResponse(error);
  }
}
