import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import { guardConfig, guardOperatorRequest, storeFailureResponse } from "@/lib/autoreply/route-guards";
import { stopAutoReply } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Turn automation off.
 *
 * Stopping needs no argument and cannot fail on a state check, because the one
 * thing it must always be able to do is stop. Afterwards every scheduled run
 * reads enabled = false and returns zero sends — there is no separate "after
 * stop" code path to get wrong.
 *
 * What it does not switch off is a person. This turns the TIMER off; approving
 * one reply by hand still works afterwards, because that gate is the prepared
 * target plus the absence of a halt, not this flag. "Stop the automation but
 * answer this one myself" has to remain possible. A halt is the other way
 * round: it outranks a person's approval, and only /enable clears it.
 *
 * It does not undo a reply that already went out. YouTube has it; only a person
 * can remove it, and this project never deletes a comment.
 */
export async function POST(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  try {
    const settings = await withExecutionBudget(() => stopAutoReply(createAutoReplyDeps()));
    return jsonResponse({
      status: "ok",
      message: "자동답글을 껐습니다. 이후 예약 실행은 답글을 보내지 않습니다.",
      settings,
    });
  } catch (error) {
    return storeFailureResponse(error);
  }
}
