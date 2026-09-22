import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { BOOTSTRAP_OUTCOME_MESSAGE, BOOTSTRAP_OUTCOME_STATUS } from "@/lib/autoreply/outcome-message";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import {
  guardConfig,
  guardOperatorRequest,
  readStringFields,
  storeFailureResponse,
} from "@/lib/autoreply/route-guards";
import { prepareAutoReplyTarget } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Prepare the target only. Never enables the schedule or sends. */
export async function POST(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  const fields = await readStringFields(request, ["videoId"]);
  if (fields === null || fields.videoId === undefined) {
    return jsonResponse({ status: "error", message: "videoId가 필요합니다." }, 400);
  }

  const { videoId } = fields;
  try {
    const report = await withExecutionBudget(() => prepareAutoReplyTarget({ videoId: videoId }, createAutoReplyDeps()));
    return jsonResponse(
      {
        status: report.outcome === "activated" ? "ok" : "error",
        outcome: report.outcome,
        message: report.outcome === "activated" ? "이 영상을 답글 대상으로 저장했습니다. 전송 0건. YouTube에 새 시험 댓글 작성 → 댓글 다시 읽기 순서로 진행하세요." : BOOTSTRAP_OUTCOME_MESSAGE[report.outcome],
        sentCount: report.sentCount,
        settings: report.settings,
      },
      BOOTSTRAP_OUTCOME_STATUS[report.outcome],
    );
  } catch (error) {
    return storeFailureResponse(error);
  }
}
