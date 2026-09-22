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
import { bootstrapAutoReply } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Enables only the target and baseline the person reviewed. Never clears a halt. */
export async function POST(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  const fields = await readStringFields(request, ["videoId", "activatedAt"]);
  if (fields === null || fields.videoId === undefined || fields.activatedAt === undefined) {
    return jsonResponse({ status: "error", message: "videoId와 화면에서 확인한 activatedAt이 필요합니다." }, 400);
  }

  const { activatedAt, videoId } = fields;
  try {
    const report = await withExecutionBudget(() => bootstrapAutoReply({ videoId: videoId, activatedAt: activatedAt }, createAutoReplyDeps()));
    return jsonResponse(
      {
        status: report.outcome === "activated" ? "ok" : "error",
        outcome: report.outcome,
        message: BOOTSTRAP_OUTCOME_MESSAGE[report.outcome],
        sentCount: report.sentCount,
        settings: report.settings,
      },
      BOOTSTRAP_OUTCOME_STATUS[report.outcome],
    );
  } catch (error) {
    return storeFailureResponse(error);
  }
}
