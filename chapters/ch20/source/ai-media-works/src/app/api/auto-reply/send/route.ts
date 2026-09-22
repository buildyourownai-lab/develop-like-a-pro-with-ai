import { withExecutionBudget } from "@/lib/execution-budget";
import { jsonResponse } from "@/lib/http";
import { OUTCOME_MESSAGE, OUTCOME_STATUS } from "@/lib/autoreply/outcome-message";
import { createAutoReplyDeps } from "@/lib/autoreply/real-deps";
import {
  guardConfig,
  guardOperatorRequest,
  readStringFields,
  storeFailureResponse,
} from "@/lib/autoreply/route-guards";
import { sendApprovedReply } from "@/lib/autoreply/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The second of the two requests a person's approval takes: send that reply.
 *
 * The body carries a video id, a comment id, and the approval token
 * /api/auto-reply/prepare issued. It does NOT carry the reply text, and any
 * text field in it is ignored: the sentence comes out of the token's signed
 * payload, so what goes to comments.insert is byte for byte what the person
 * read. If the request could supply text, approving a comment would become
 * "post this for me" and every check in the project would be optional.
 *
 * The token is required here, not optional. Without one there would be no way
 * to tell what was on screen, and the only alternative — drafting again now —
 * would send a sentence nobody approved. A request with no token is a 400
 * before any work: it is a caller mistake, not a state conflict.
 *
 * A refused token answers 409 with `approvalIssue` saying which way it was
 * refused (tampered, expired, for another comment, for a comment that has been
 * edited since, or a sentence that no longer passes its checks). 409 rather
 * than 400 because the token itself is well-formed input — what changed is the
 * world it was issued against, and a fresh preview fixes it.
 *
 * Approval does not lift any limit and does not need the SCHEDULE to be on.
 * The five-per-Asia/Seoul-day counter, the one-record-per-comment rule, the
 * start-time floor, and the halt after an unobserved send all still apply,
 * because they are enforced inside sendApprovedReply and in the database, not
 * at the door.
 */
export async function POST(request: Request) {
  const unauthorized = guardOperatorRequest(request);
  if (unauthorized !== null) return unauthorized;

  const misconfigured = guardConfig();
  if (misconfigured !== null) return misconfigured;

  const fields = await readStringFields(request, [
    "videoId",
    "topLevelCommentId",
    "approvalToken",
  ]);
  if (fields === null || fields.videoId === undefined || fields.topLevelCommentId === undefined) {
    return jsonResponse(
      { status: "error", message: "videoId와 topLevelCommentId가 필요합니다." },
      400,
    );
  }
  if (fields.approvalToken === undefined) {
    return jsonResponse(
      {
        status: "error",
        message: "승인 정보가 없습니다. 미리보기를 먼저 불러와 문장을 확인한 뒤 승인하세요.",
      },
      400,
    );
  }

  const { approvalToken, topLevelCommentId, videoId } = fields;
  try {
    const report = await withExecutionBudget(() => sendApprovedReply(
      {
        videoId: videoId,
        topLevelCommentId: topLevelCommentId,
        approvalToken: approvalToken,
      },
      createAutoReplyDeps(),
    ));
    return jsonResponse(
      {
        status: report.outcome === "sent" ? "ok" : "error",
        outcome: report.outcome,
        message: OUTCOME_MESSAGE[report.outcome],
        sentCount: report.sentCount,
        // Ids only. The comment's text and the reply's text are never echoed
        // back by a route that runs on a deployed server — not even the
        // sentence that was just sent.
        targetCommentId: report.targetCommentId,
        replyCommentId: report.replyCommentId,
        // A fixed label from a closed set, so the screen can say WHY an
        // approval was refused without a second request. Null otherwise.
        approvalIssue: report.approvalIssue,
        skipped: report.skipped,
        dayCounts: report.dayCounts,
        automationEnabled: report.automationEnabled,
      },
      OUTCOME_STATUS[report.outcome],
    );
  } catch (error) {
    return storeFailureResponse(error);
  }
}
