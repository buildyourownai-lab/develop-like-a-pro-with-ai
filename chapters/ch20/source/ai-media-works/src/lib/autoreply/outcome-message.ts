import { ApprovalPreviewOutcome, BootstrapOutcome, ManualSendOutcome } from "./runner";

/**
 * Fixed Korean text for every outcome, and the HTTP status that goes with it.
 *
 * Two rules this file exists to keep. First, the browser only ever sees a
 * message from these tables — never an error's own message, which could carry
 * a local path, a URL, or a secret. Second, the tables are exhaustive Records
 * over the outcome unions, so adding an outcome without writing its message
 * and status fails typecheck instead of shipping an unexplained blank.
 */

export const OUTCOME_MESSAGE: Record<ManualSendOutcome, string> = {
  needs_review: "기존 답글 또는 최근 1시간의 동일 문장 여부를 확인하세요. 자동으로 보내지 않고 사람 확인으로 남겼습니다.",
  run_failed: "실행 중 오류가 발생했습니다. 상태 기록을 확인하세요.",
  disabled: "자동답글이 꺼져 있습니다. 전송하지 않았습니다.",
  not_configured: "자동답글에 사용할 채널과 영상이 아직 저장되지 않았습니다.",
  video_check_failed:
    "저장된 영상이 지금도 내 채널의 공개 또는 일부 공개 영상인지 확인하지 못했습니다. 전송하지 않았습니다.",
  comments_unavailable: "댓글 목록을 읽지 못했습니다. 전송하지 않았습니다.",
  no_target: "보낼 조건에 맞는 새 댓글이 없습니다.",
  already_recorded: "이 댓글은 이미 처리 기록이 있습니다. 다시 보내지 않았습니다.",
  sent: "답글 1개를 보냈습니다.",
  send_rejected: "YouTube가 전송을 거절했습니다. 답글은 만들어지지 않았습니다.",
  halted_result_unknown:
    "전송 결과를 확인하지 못했습니다. 답글이 올라갔을 수 있어 다시 보내지 않고 자동답글을 껐습니다.",
  halted:
    "이전 전송의 결과를 확인하지 못해 멈춘 상태입니다. 사람이 확인하기 전까지는 아무것도 보내지 않습니다.",
  send_in_progress: "다른 전송이 진행 중입니다. 잠시 뒤에 다시 시도하세요.",
  comment_not_found: "그 댓글을 승인한 영상의 최근 댓글 20개에서 찾지 못했습니다.",
  video_not_approved: "승인해 둔 영상이 아닙니다.",
  not_eligible: "이 댓글은 자동으로 답글을 보낼 조건이 아닙니다. 직접 답글을 쓰세요.",
  approval_invalid:
    "승인 정보가 더 이상 유효하지 않습니다. 미리보기를 다시 불러와 확인한 뒤 승인하세요.",
};

export const OUTCOME_STATUS: Record<ManualSendOutcome, number> = {
  needs_review: 409,
  run_failed: 500,
  disabled: 409,
  not_configured: 409,
  video_check_failed: 403,
  comments_unavailable: 502,
  no_target: 200,
  already_recorded: 200,
  sent: 200,
  send_rejected: 502,
  // 409, not 500: the server did its job correctly by refusing to guess.
  halted_result_unknown: 409,
  halted: 409,
  // 409, not 503: nothing is broken, and the same request may work in a minute.
  send_in_progress: 409,
  comment_not_found: 404,
  video_not_approved: 403,
  not_eligible: 409,
  approval_invalid: 409,
};

/**
 * The first half of the approval flow: showing one draft. Nothing here reports
 * a send, because preparing a reply cannot send one — so the wording says what
 * did NOT happen as plainly as what did.
 */
export const PREVIEW_OUTCOME_MESSAGE: Record<ApprovalPreviewOutcome, string> = {
  ready:
    "답글 1개를 준비했습니다. 화면에 보이는 문장을 확인한 뒤 승인하세요. 아직 보내지 않았습니다.",
  not_configured: "자동답글에 사용할 채널과 영상이 아직 저장되지 않았습니다.",
  video_not_approved:
    "이미 다른 영상이 답글 대상으로 저장되어 있습니다. 저장된 영상에서만 준비할 수 있습니다.",
  video_check_failed:
    "저장된 영상이 지금도 내 채널의 공개 또는 일부 공개 영상인지 확인하지 못했습니다. 초안을 만들지 않았습니다.",
  channel_mismatch: "이 영상은 연결된 계정의 채널 소유가 아닙니다. 답글 대상으로 저장하지 않았습니다.",
  privacy_blocked:
    "이 영상은 비공개이거나 공개 범위를 확인할 수 없습니다. 공개 또는 일부 공개 영상을 선택하세요.",
  comments_unavailable: "댓글 목록을 읽지 못했습니다. 초안을 만들지 않았습니다.",
  comment_not_found: "그 댓글을 승인한 영상의 최근 댓글 20개에서 찾지 못했습니다.",
  already_recorded: "이 댓글은 이미 처리 기록이 있습니다. 초안을 만들지 않았습니다.",
  not_eligible: "이 댓글은 자동으로 답글을 보낼 조건이 아닙니다. 직접 답글을 쓰세요.",
};

export const PREVIEW_OUTCOME_STATUS: Record<ApprovalPreviewOutcome, number> = {
  ready: 200,
  not_configured: 409,
  video_not_approved: 403,
  video_check_failed: 403,
  // 403 like the other two target refusals: the request was understood and the
  // server will not store this video as the target, whoever asks.
  channel_mismatch: 403,
  privacy_blocked: 403,
  comments_unavailable: 502,
  // 200, like the send route: the server answered correctly, and the answer is
  // "there is nothing here to approve".
  already_recorded: 200,
  comment_not_found: 404,
  not_eligible: 409,
};

export const BOOTSTRAP_OUTCOME_MESSAGE: Record<BootstrapOutcome, string> = {
  halted: "대상 준비·진행 중 전송·결과 미확인 상태를 확인하세요. 예약 실행을 켜지 않았습니다.",
  activated:
    "예약 실행을 켰습니다. 처음 대상을 준비할 때 정한 기준 시각 이후의 댓글이 대상입니다. 이번 설정 요청의 전송은 0건입니다.",
  channel_mismatch: "이 영상은 연결된 계정의 채널 소유가 아닙니다.",
  privacy_blocked:
    "이 영상은 비공개이거나 공개 범위를 확인할 수 없습니다. 공개 또는 일부 공개 영상을 선택하세요.",
  video_check_failed: "영상 정보를 확인하지 못했습니다.",
};

export const BOOTSTRAP_OUTCOME_STATUS: Record<BootstrapOutcome, number> = {
  activated: 200,
  halted: 409,
  channel_mismatch: 403,
  privacy_blocked: 403,
  video_check_failed: 502,
};
