import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { OUTCOME_MESSAGE } from "@/lib/autoreply/outcome-message";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import {
  guardConfig,
  guardSchedulerRequest,
  storeFailureResponse,
} from "@/lib/autoreply/route-guards";
import { runScheduledAutoReply } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The endpoint the timer calls. Nobody is watching when it runs, so it is the
 * strictest one.
 *
 * Authentication is never optional here, not even locally: without
 * AUTO_REPLY_SCHEDULER_SECRET set, guardSchedulerRequest refuses every request.
 * An endpoint that can post a reply to a real viewer must not be reachable by
 * anyone who happens to find the URL. The secret arrives in the Authorization
 * header, so it never lands in a URL, a query log, or an access log.
 *
 * On success this returns HTTP 200 with the outcome inside the body, even when
 * zero replies were sent and even when the run halted. Those are correct
 * results of a healthy server, and a scheduler treats a non-2xx as something to
 * retry — retrying a halt is the one thing that must never happen. So read the
 * body: HTTP 200 means "the call arrived and the server answered", and
 * `outcome` is what actually happened.
 */
export async function POST(request: Request) {
  const unauthorized = guardSchedulerRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  try {
    const report = await withExecutionBudget(() => runScheduledAutoReply(createAutoReplyDeps()));
    return jsonResponse({
      status: "ok",
      outcome: report.outcome,
      message: OUTCOME_MESSAGE[report.outcome],
      sentCount: report.sentCount,
      targetCommentId: report.targetCommentId,
      replyCommentId: report.replyCommentId,
      consideredCount: report.consideredCount,
      deferredCount: report.deferredCount,
      skipped: report.skipped,
      reconciled: report.reconciled,
      dayCounts: report.dayCounts,
      automationEnabled: report.automationEnabled,
    });
  } catch (error) {
    return storeFailureResponse(error);
  }
}
