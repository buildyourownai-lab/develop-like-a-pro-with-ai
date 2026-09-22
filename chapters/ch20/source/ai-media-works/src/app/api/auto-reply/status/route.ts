import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import { guardConfig, guardOperatorRequest, storeFailureResponse } from "@/lib/autoreply/route-guards";
import { readAutoReplyStatus } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the server currently thinks: on or off, which video, since when, how
 * many of today's five slots are used, and the recent send records.
 *
 * A record here is ids, a status, a reason label, and times. There is no field
 * for the comment's text, the commenter, or the reply text, because the store
 * has no column for them — see the contract at the top of
 * src/lib/autoreply/store.ts. So this route stays safe to call on a deployed
 * server, unlike chapter 19's preview routes.
 */
export async function GET(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  try {
    const status = await withExecutionBudget(() => readAutoReplyStatus(createAutoReplyDeps()));
    return jsonResponse({ status: "ok", ...status });
  } catch (error) {
    return storeFailureResponse(error);
  }
}
