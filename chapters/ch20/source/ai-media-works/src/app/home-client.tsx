"use client";

import { useState } from "react";
import type { RunRecord } from "@/lib/autoreply/store";
import Image from "next/image";
import { CATEGORY_LABEL } from "@/lib/comments/category-label";
import { CommentReviewItem, FetchedComment, ProcessingTier } from "@/lib/comments/types";
import { privacyDisplayLabel } from "@/lib/youtube/privacy-label";

type VideoCheckResponse =
  | {
      status: "ok";
      videoId: string;
      title: string;
      channelTitle: string;
      privacyStatus: string;
      commentReadEligible: boolean;
      channelMatches: boolean;
      myChannelId: string;
      fetchedAt: string;
    }
  | {
      status: "error";
      target?: "video" | "channel";
      reason?: string;
      message?: string;
    };

type ReviewResponse = {
  status: "ok" | "partial" | "error";
  reason?: string;
  items?: CommentReviewItem[];
  message?: string;
};

type CommentsResponse = {
  status: "ok" | "error";
  reason?: string;
  comments?: FetchedComment[];
  count?: number;
  skippedCount?: number;
  isPartial?: boolean;
  fetchedAt?: string;
  note?: string;
  message?: string;
};

type AutoReplySettingsView = {
  enabled: boolean;
  channelId: string | null;
  videoId: string | null;
  activatedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
};

/**
 * One send record as the status route returns it: ids, a status, a short reason
 * label, and times. There is no field for the comment's text or the reply's
 * text, because the server never stored either — see the contract at the top of
 * src/lib/autoreply/store.ts.
 */
type AutoReplySendRecordView = {
  topLevelCommentId: string;
  videoId: string;
  status: string;
  reason: string | null;
  replyCommentId: string | null;
  sendDay: string;
  claimedAt: string;
  resolvedAt: string | null;
  lockExpiresAt: string;
};

type AutoReplyStatusResponse = {
  status: "ok" | "error";
  reason?: string;
  message?: string;
  settings?: AutoReplySettingsView | null;
  sendDay?: string;
  dayCounts?: { reservedCount: number; sentCount: number };
  recentSends?: AutoReplySendRecordView[];
  recentRuns?: RunRecord[];
};

type AutoReplyActionResponse = {
  status: "ok" | "error";
  outcome?: string;
  reason?: string;
  message?: string;
  sentCount?: number;
  replyCommentId?: string | null;
  settings?: AutoReplySettingsView | null;
};

/**
 * What /api/auto-reply/prepare answers.
 *
 * `draft` is the exact sentence the server will publish, and `approvalToken` is
 * that sentence under a signature. The send request carries the token instead of
 * the text, which is what makes "the sentence on screen is the sentence that
 * goes out" a fact rather than a hope: this screen cannot change it, and cannot
 * substitute one of its own.
 */
type AutoReplyPrepareResponse = {
  status: "ok" | "error";
  outcome?: string;
  reason?: string;
  message?: string;
  targetCommentId?: string | null;
  /** True when this call stored the video as the reply target for the first time. */
  targetPrepared?: boolean;
  draft?: string | null;
  approvalToken?: string | null;
  skipped?: Array<{ topLevelCommentId: string; reason: string }>;
};

const COMMENT_ERROR_INFO: Record<string, { message: string; nextAction: string }> = {
  comments_disabled: {
    message: "이 영상은 댓글이 꺼져 있습니다.",
    nextAction: "다음 행동: 댓글이 켜진 다른 시험 영상을 선택하세요.",
  },
  forbidden: {
    message: "이 계정에 댓글을 읽을 권한이 없습니다.",
    nextAction: "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 OAuth 동의 화면과 데이터 액세스 설정을 확인하세요.",
  },
  auth_error: {
    message: "인증이 만료되었거나 올바르지 않습니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  quota_exceeded: {
    message: "YouTube API 사용량 한도에 도달했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하거나 Google Cloud Console에서 할당량을 확인하세요.",
  },
  network_error: {
    message: "YouTube와 통신하지 못했습니다.",
    nextAction: "다음 행동: 인터넷 연결을 확인한 뒤 다시 시도하세요.",
  },
  invalid_response: {
    message: "YouTube 응답 형식을 확인하지 못했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  video_not_found: {
    message: "이 영상을 더 이상 찾을 수 없습니다.",
    nextAction: "다음 행동: YouTube Studio에서 영상이 남아 있는지 확인한 뒤 1단계부터 다시 확인하세요.",
  },
  config_missing: {
    message: "서버에 YouTube 연동 설정이 아직 없습니다.",
    nextAction: "다음 행동: README의 로컬 OAuth 설정 절차를 먼저 진행하세요.",
  },
  credential_file_invalid: {
    message: "YouTube 인증 설정을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 내 컴퓨터에서 실행 중이면 설정된 두 파일 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)의 파일이 있는지와 그 내용이 올바른 JSON인지 확인하세요. 배포한 서버라면 JSON 값을 그대로 넣는 설정(YOUTUBE_OAUTH_CLIENT_JSON, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON)의 값을 확인하세요. 자격증명 하나당 파일 경로와 JSON 값 중 하나만 설정해야 하며, 자세한 절차는 README를 보세요.",
  },
  scope_insufficient: {
    message: "인증 Token의 권한 범위가 부족합니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  ownership_video_not_found: {
    message: "이 주소의 영상을 찾을 수 없거나 연결된 계정에서 볼 수 없습니다.",
    nextAction: "다음 행동: 내 채널의 시험 영상 주소를 다시 확인해 입력하세요.",
  },
  ownership_channel_not_found: {
    message: "연결된 계정에서 내 YouTube 채널을 찾지 못했습니다.",
    nextAction:
      "다음 행동: 채널이 있는 Google 계정으로 npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요.",
  },
  ownership_scope_insufficient: {
    message: "인증 Token의 권한 범위가 부족합니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  ownership_credential_file_invalid: {
    message: "YouTube 인증 설정을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 내 컴퓨터에서 실행 중이면 설정된 두 파일 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)의 파일이 있는지와 그 내용이 올바른 JSON인지 확인하세요. 배포한 서버라면 JSON 값을 그대로 넣는 설정(YOUTUBE_OAUTH_CLIENT_JSON, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON)의 값을 확인하세요. 자격증명 하나당 파일 경로와 JSON 값 중 하나만 설정해야 하며, 자세한 절차는 README를 보세요.",
  },
  ownership_quota_exceeded: {
    message: "YouTube API 사용량 한도에 도달했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하거나 Google Cloud Console에서 할당량을 확인하세요.",
  },
  channel_mismatch: {
    message: "이 영상은 연결된 계정의 채널이 아닙니다.",
    nextAction: "다음 행동: 본인 채널의 시험 영상 주소를 다시 입력하세요.",
  },
  privacy_blocked: {
    message: "이 영상은 비공개이거나 공개 범위를 확인할 수 없습니다.",
    nextAction: "다음 행동: 공개 또는 일부 공개(unlisted) 상태의 다른 시험 영상을 선택하세요.",
  },
  ownership_check_failed: {
    message: "채널 소유·공개 범위 확인에 실패했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  ownership_config_missing: {
    message: "서버에 YouTube 연동 설정이 아직 없습니다.",
    nextAction: "다음 행동: README의 로컬 OAuth 설정 절차를 먼저 진행하세요.",
  },
  ownership_invalid_response: {
    message: "YouTube 응답 형식을 확인하지 못했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  ownership_auth_error: {
    message: "인증이 만료되었거나 올바르지 않습니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  ownership_network_error: {
    message: "YouTube와 통신하지 못했습니다.",
    nextAction: "다음 행동: 인터넷 연결을 확인한 뒤 다시 시도하세요.",
  },
  unexpected_error: {
    message: "예상하지 못한 오류가 발생했습니다.",
    nextAction: "다음 행동: 잠시 후 새로고침한 뒤 다시 시도하세요.",
  },
};

const VIDEO_ERROR_INFO: Record<string, { message: string; nextAction: string }> = {
  config_missing: {
    message: "서버에 YouTube 연동 설정이 아직 없습니다.",
    nextAction: "다음 행동: README의 로컬 OAuth 설정 절차를 먼저 진행하세요.",
  },
  invalid_response: {
    message: "YouTube 응답 형식을 확인하지 못했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  credential_file_invalid: {
    message: "YouTube 인증 설정을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 내 컴퓨터에서 실행 중이면 설정된 두 파일 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)의 파일이 있는지와 그 내용이 올바른 JSON인지 확인하세요. 배포한 서버라면 JSON 값을 그대로 넣는 설정(YOUTUBE_OAUTH_CLIENT_JSON, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON)의 값을 확인하세요. 자격증명 하나당 파일 경로와 JSON 값 중 하나만 설정해야 하며, 자세한 절차는 README를 보세요.",
  },
  scope_insufficient: {
    message: "인증 Token의 권한 범위가 부족합니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  auth_error: {
    message: "인증이 만료되었거나 올바르지 않습니다.",
    nextAction:
      "다음 행동: npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고, .env.local에 YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH=.secrets/youtube-comment-read-oauth.json을 설정한 뒤 서버를 재시작하세요. 계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요.",
  },
  network_error: {
    message: "YouTube와 통신하지 못했습니다.",
    nextAction: "다음 행동: 인터넷 연결을 확인한 뒤 다시 시도하세요.",
  },
  video_not_found: {
    message: "이 주소의 영상을 찾을 수 없거나 연결된 계정에서 볼 수 없습니다.",
    nextAction: "다음 행동: 주소를 다시 확인하고, 삭제되지 않은 내 채널의 시험 영상인지 확인하세요.",
  },
  channel_not_found: {
    message: "연결된 계정에서 내 YouTube 채널을 찾지 못했습니다.",
    nextAction: "다음 행동: YouTube 채널이 있는 Google 계정으로 인증했는지 확인한 뒤 다시 시도하세요.",
  },
  lookup_failed: {
    message: "정보를 확인하지 못했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  unexpected_error: {
    message: "예상하지 못한 오류가 발생했습니다.",
    nextAction: "다음 행동: 잠시 후 새로고침한 뒤 다시 시도하세요.",
  },
};

const VIDEO_ERROR_TARGET_LABEL: Record<string, string> = {
  video: "영상 확인 실패",
  channel: "채널 확인 실패",
};

// Keyed by the closed GeminiIssueReason set (src/lib/gemini/error-classification.ts).
// Kept as a plain string-keyed record — like COMMENT_ERROR_INFO/VIDEO_ERROR_INFO
// above — instead of importing that server module's type, since this file is a
// client component and must never pull in the Gemini SDK it's built on.
const GEMINI_ISSUE_INFO: Record<string, { message: string; label: string; nextAction: string }> = {
  config_missing: {
    label: "설정 없음",
    message: "서버에 Gemini 연동 설정이 없습니다.",
    nextAction: "다음 행동: .env.local에 GEMINI_API_KEY와 GEMINI_MODEL을 설정한 뒤 서버를 재시작하세요.",
  },
  auth_error: {
    label: "인증 실패",
    message: "Gemini 인증에 실패했습니다.",
    nextAction: "다음 행동: GEMINI_API_KEY의 권한(키가 유효하고 활성 상태인지)을 확인하세요.",
  },
  quota_exceeded: {
    label: "한도 초과",
    message: "Gemini API 사용량 한도에 도달했습니다.",
    nextAction: "다음 행동: 사용량 한도를 확인한 뒤 잠시 후 다시 시도하세요.",
  },
  model_or_request_error: {
    label: "모델·요청 오류",
    message: "Gemini 모델 또는 요청 형식을 확인하지 못했습니다.",
    nextAction: "다음 행동: GEMINI_MODEL 값이 지원되는 모델 이름인지 확인하세요.",
  },
  network_error: {
    label: "통신 실패",
    message: "Gemini와 통신하지 못했습니다.",
    nextAction: "다음 행동: 인터넷 연결을 확인한 뒤 다시 시도하세요.",
  },
  invalid_response: {
    label: "응답 형식 오류",
    message: "Gemini 응답 형식을 확인하지 못했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
  service_error: {
    label: "서비스 오류",
    message: "Gemini 서비스에서 예상하지 못한 오류가 발생했습니다.",
    nextAction: "다음 행동: 잠시 후 다시 시도하세요.",
  },
};

const GEMINI_ISSUE_STAGE_LABEL: Record<string, string> = {
  classification: "분류",
  draft: "초안 생성",
  context_check: "AI 문맥 검사",
};

/**
 * Which credential sets the server found configured. "partial" exists because
 * claiming "외부 호출 없음" while, say, only the Gemini key is missing would be
 * false — the YouTube calls in steps 1 and 2 do go out in that state.
 */
export type ConfigStatus = "configured" | "partial" | "unconfigured";

const CONFIG_STATUS_BANNER: Record<ConfigStatus, string> = {
  configured: "연결 설정 입력됨 · 실제 확인 전",
  partial: "일부 연결 설정만 입력됨 · 실제 확인 전",
  unconfigured: "설정 대기 · 외부 호출 없음",
};

const TIER_LABEL: Record<ProcessingTier, string> = {
  AUTO_REPLY_CANDIDATE: "자동답글 후보",
  HUMAN_REVIEW: "사람 확인",
  NO_REPLY: "답하지 않음",
};

const TIER_CLASS: Record<ProcessingTier, string> = {
  AUTO_REPLY_CANDIDATE: "auto",
  HUMAN_REVIEW: "human",
  NO_REPLY: "none",
};

const TIER_SYMBOL: Record<ProcessingTier, string> = {
  AUTO_REPLY_CANDIDATE: "✓",
  HUMAN_REVIEW: "？",
  NO_REPLY: "✕",
};

// Keyed by the closed SendStatus set (src/lib/autoreply/store.ts). Kept as a
// plain string-keyed record for the same reason as the maps above: this file is
// a client component and must not import the server-only storage module.
const SEND_STATUS_LABEL: Record<string, string> = {
  CLAIMED: "보내는 중 · 결과 미확인",
  SENT: "보냄 · YouTube가 답글 id를 확인",
  RESULT_UNKNOWN: "결과 확인 못함 · 자동답글 멈춤",
  UNCONFIRMED_NO_REPLY: "답글을 찾지 못함 · 자동 재전송 없음",
  FAILED: "거절됨 · 답글이 만들어지지 않음",
};

// Keyed by the closed StopReason set (src/lib/autoreply/store.ts).
const STOP_REASON_LABEL: Record<string, string> = {
  manual: "예약 실행이 중지됐습니다. 최근 실행의 오류 여부를 확인하세요.",
  result_unknown: "전송 결과를 확인하지 못해 스스로 멈췄습니다. 사람이 실제 결과를 확인해야 하며, 이 화면에서는 중단을 해제할 수 없습니다.",
};

// Keyed by the closed SkipReason set (src/lib/autoreply/policy.ts). A refusal
// that only said "보낼 수 없습니다" would leave a person with nothing to do, so
// each reason names the next step — including the one that surprises everybody:
// the reply target's saved time is a floor, so comments already on the video
// stay out of scope for good.
const SKIP_REASON_INFO: Record<string, { label: string; nextAction: string }> = {
  video_owner_comment: {
    label: "영상 게시자가 작성한 댓글이라 답글 대상에서 제외했습니다.",
    nextAction: "다음 행동: 일반 시청자가 작성한 댓글을 고르세요.",
  },
  unknown_author: {
    label: "댓글 작성 채널을 확인할 수 없어 안전하게 제외했습니다.",
    nextAction: "다음 행동: 작성 채널을 확인할 수 있는 일반 시청자 댓글을 고르세요.",
  },
  invalid_published_at: {
    label: "댓글의 작성 시각을 확인할 수 없습니다.",
    nextAction: "다음 행동: 이 댓글은 사람이 직접 답글을 쓰세요.",
  },
  published_before_activation: {
    label: "답글 대상으로 저장한 시각보다 먼저 올라온 댓글입니다.",
    nextAction:
      "다음 행동: 저장 시각 이후에 새로 올라온 댓글을 골라 다시 준비하세요. 이미 있던 댓글은 이 프로그램이 보내지 않으니 사람이 직접 답글을 쓰세요.",
  },
  older_than_recent_window: {
    label: "올라온 지 7일이 지난 댓글입니다.",
    nextAction: "다음 행동: 더 최근 댓글을 고르거나, 이 댓글은 사람이 직접 답글을 쓰세요.",
  },
  not_auto_reply_tier: {
    label: "처리 수준이 자동답글 후보가 아닙니다.",
    nextAction: "다음 행동: 3단계에서 자동답글 후보로 분류된 댓글을 고르세요.",
  },
  category_not_auto_reply: {
    label: "질문·사실 정정·광고처럼 자동으로 답하지 않는 분류입니다.",
    nextAction: "다음 행동: 이 댓글은 사람이 직접 답글을 쓰세요.",
  },
  verification_not_passed: {
    label: "초안이 두 검사를 통과하지 못했습니다.",
    nextAction: "다음 행동: 다시 준비해도 같은 결과라면 사람이 직접 답글을 쓰세요.",
  },
  no_draft: {
    label: "보낼 초안이 만들어지지 않았습니다.",
    nextAction: "다음 행동: 잠시 후 다시 준비하거나, 사람이 직접 답글을 쓰세요.",
  },
};

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ko-KR");
  } catch {
    return iso;
  }
}

export default function HomeClient({ configStatus, storeConfigured = false }: { configStatus: ConfigStatus; storeConfigured?: boolean }) {
  const [videoUrl, setVideoUrl] = useState("");
  const [videoCheck, setVideoCheck] = useState<VideoCheckResponse | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [videoClientError, setVideoClientError] = useState<string | null>(null);

  const [comments, setComments] = useState<FetchedComment[] | null>(null);
  const [commentsStatus, setCommentsStatus] = useState<CommentsResponse | null>(null);
  const [commentsBusy, setCommentsBusy] = useState(false);
  const [commentsClientError, setCommentsClientError] = useState<string | null>(null);

  const [items, setItems] = useState<CommentReviewItem[] | null>(null);
  const [reviewStatus, setReviewStatus] = useState<"ok" | "partial" | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewErrorNextAction, setReviewErrorNextAction] = useState<string | null>(null);

  const [autoStatus, setAutoStatus] = useState<AutoReplyStatusResponse | null>(null);
  const [autoBusy, setAutoBusy] = useState<"status" | "enable" | "stop" | "target" | null>(null);
  const [decision, setDecision] = useState<{ action: "target" | "enable"; videoId: string; baseline: string | null } | null>(null);
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const [autoMessage, setAutoMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // The one-off approval, which is a three-step state: a comment is chosen, a
  // sentence has been prepared for it, and then it has been sent or refused.
  const [approvalTargetId, setApprovalTargetId] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<
    { topLevelCommentId: string; draft: string; approvalToken: string } | null
  >(null);
  const [prepareResult, setPrepareResult] = useState<
    { ok: boolean; text: string; nextAction: string | null; targetPrepared: boolean } | null
  >(null);
  const [prepareBusy, setPrepareBusy] = useState(false);
  const [sendBusy, setSendBusy] = useState(false);
  const [sendResult, setSendResult] = useState<
    { ok: boolean; text: string; replyCommentId: string | null } | null
  >(null);

  /**
   * Forgets a prepared sentence.
   *
   * Called whenever anything it was signed against may have moved: a different
   * comment, a different video, a fresh review. A token outlives none of those,
   * and a screen still showing one would be offering to send a sentence the
   * server would refuse.
   */
  function clearApproval() {
    setApprovalTargetId(null);
    setPrepared(null);
    setPrepareResult(null);
    setSendResult(null);
  }

  // A new video check or comments load invalidates any prior review — clear
  // the whole downstream state together so a stale partial/error warning
  // from the previous batch can never outlive it.
  function resetReviewState() {
    setItems(null);
    setReviewStatus(null);
    setReviewError(null);
    setReviewErrorNextAction(null);
    // The approval belongs to the batch being cleared, and a prepared sentence
    // shown next to a different comment would be worse than none.
    clearApproval();
  }

  async function checkVideo() {
    setDecision(null);
    setTargetNotice(null);
    setVideoBusy(true);
    setVideoCheck(null);
    setVideoClientError(null);
    setComments(null);
    setCommentsStatus(null);
    setCommentsClientError(null);
    resetReviewState();
    try {
      const response = await fetch("/api/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl }),
      });
      let body: VideoCheckResponse;
      try {
        body = (await response.json()) as VideoCheckResponse;
      } catch {
        setVideoClientError("서버 응답을 이해할 수 없습니다. 잠시 후 다시 시도하세요.");
        return;
      }
      setVideoCheck(body);
    } catch {
      setVideoClientError("네트워크 오류로 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.");
    } finally {
      setVideoBusy(false);
    }
  }

  async function loadComments() {
    if (videoCheck?.status !== "ok") return;
    const videoId = videoCheck.videoId;
    setCommentsBusy(true);
    setComments(null);
    setCommentsStatus(null);
    setCommentsClientError(null);
    resetReviewState();
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      let body: CommentsResponse;
      try {
        body = (await response.json()) as CommentsResponse;
      } catch {
        setCommentsClientError("서버 응답을 이해할 수 없습니다. 잠시 후 다시 시도하세요.");
        return;
      }
      setCommentsStatus(body);
      setComments(body.comments ?? null);
    } catch {
      setCommentsClientError("네트워크 오류로 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.");
    } finally {
      setCommentsBusy(false);
    }
  }

  async function reviewComments() {
    if (!comments || comments.length === 0) return;
    setReviewBusy(true);
    resetReviewState();
    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comments }),
      });
      let body: ReviewResponse;
      try {
        body = (await response.json()) as ReviewResponse;
      } catch {
        setReviewError("서버 응답을 이해할 수 없습니다. 잠시 후 다시 시도하세요.");
        return;
      }
      // status "ok" or "partial" both carry safe, real items — only "error"
      // (e.g. missing GEMINI_API_KEY/GEMINI_MODEL, checked before any
      // comment is processed) has none to show.
      if (body.status === "error" || !body.items) {
        const issueInfo = body.reason ? GEMINI_ISSUE_INFO[body.reason] : undefined;
        setReviewError(issueInfo?.message ?? body.message ?? "분류·초안 요청이 실패했습니다.");
        setReviewErrorNextAction(issueInfo?.nextAction ?? null);
        return;
      }
      setItems(body.items);
      setReviewStatus(body.status);
    } catch {
      setReviewError("네트워크 오류로 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.");
    } finally {
      setReviewBusy(false);
    }
  }

  /**
   * One request to an /api/auto-reply/* route. Every one of those routes answers
   * with a fixed message from a closed table (src/lib/autoreply/outcome-message.ts,
   * request-auth.ts, errors.ts), so body.message is safe to show as it is — it can
   * never be a raw error, a path, or a secret.
   */
  async function autoReplyRequest<T>(path: string, body?: unknown): Promise<T | null> {
    try {
      const response = await fetch(
        `/api/auto-reply/${path}`,
        body === undefined
          ? { method: "GET" }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
      );
      try {
        return (await response.json()) as T;
      } catch {
        setAutoMessage({ ok: false, text: "서버 응답을 이해할 수 없습니다. 잠시 후 다시 시도하세요." });
        return null;
      }
    } catch {
      setAutoMessage({
        ok: false,
        text: "네트워크 오류로 요청을 보내지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요.",
      });
      return null;
    }
  }

  async function loadAutoStatus() {
    const body = await autoReplyRequest<AutoReplyStatusResponse>("status");
    if (body) setAutoStatus(body);
    return body;
  }

  async function refreshAutoStatus() {
    setAutoBusy("status");
    setAutoMessage(null);
    await loadAutoStatus();
    setAutoBusy(null);
  }

  async function reviewDecision(action: "target" | "enable") {
    if (videoCheck?.status !== "ok") return;
    setAutoBusy("status");
    setAutoMessage(null);
    const body = await loadAutoStatus();
    if (body?.status === "ok" && body.settings && body.settings.stopReason !== "result_unknown") {
      if (action === "target" || body.settings.videoId === videoCheck.videoId) {
        setDecision({ action, videoId: videoCheck.videoId, baseline: body.settings.videoId === videoCheck.videoId ? body.settings.activatedAt : null });
      } else setAutoMessage({ ok: false, text: "먼저 4단계에서 이 영상을 답글 대상으로 정하세요." });
    } else setAutoMessage({ ok: false, text: body?.message ?? "상태 확인이 필요합니다. 결과 미확인 중단은 여기서 해제할 수 없습니다." });
    setAutoBusy(null);
  }

  async function confirmDecision() {
    if (!decision || videoCheck?.status !== "ok" || decision.videoId !== videoCheck.videoId) return;
    setAutoBusy(decision.action);
    const body = await autoReplyRequest<AutoReplyActionResponse>(decision.action, { videoId: decision.videoId, ...(decision.action === "enable" ? { activatedAt: decision.baseline } : {}) });
    if (body) {
      setAutoMessage({ ok: body.status === "ok", text: body.message ?? "요청 결과를 확인하지 못했습니다." });
      if (body.status === "ok" && decision.action === "target") {
        setTargetNotice("이 영상을 답글 대상으로 저장했습니다. 전송 0건. YouTube에 새 시험 댓글 작성 → 댓글 다시 읽기 → 분류 → 승인 대상 선택 순서로 진행하세요.");
        setApprovalTargetId(null);
        setPrepared(null);
        setItems(null);
      }
      await loadAutoStatus();
    }
    setDecision(null);
    setAutoBusy(null);
  }

  async function turnOffAutoReply() {
    setAutoBusy("stop");
    setAutoMessage(null);
    const body = await autoReplyRequest<AutoReplyActionResponse>("stop", {});
    if (body) {
      setAutoMessage({ ok: body.status === "ok", text: body.message ?? "자동답글을 끄지 못했습니다." });
      await loadAutoStatus();
    }
    setAutoBusy(null);
  }

  /**
   * Chooses which comment step 4 is about. Local only — no request goes out, so
   * reading and classifying in steps 1 to 3 stays free of any write path.
   */
  function selectApprovalTarget(topLevelCommentId: string) {
    setApprovalTargetId(topLevelCommentId);
    setPrepared(null);
    setPrepareResult(null);
    setSendResult(null);
  }

  /** Prepare the exact sentence only after the target has been stored. */
  async function prepareApproval(topLevelCommentId: string) {
    if (videoCheck?.status !== "ok") return;
    setPrepareBusy(true);
    setAutoMessage(null);
    setPrepared(null);
    setPrepareResult(null);
    setSendResult(null);
    const body = await autoReplyRequest<AutoReplyPrepareResponse>("prepare", {
      videoId: videoCheck.videoId,
      topLevelCommentId,
    });
    if (body) {
      const skipReason = body.skipped?.[0]?.reason;
      const skipInfo = skipReason ? SKIP_REASON_INFO[skipReason] : undefined;
      setPrepareResult({
        ok: body.outcome === "ready",
        // Both are fixed server text from a closed table, never a raw error.
        text: skipInfo ? `${body.message ?? ""} ${skipInfo.label}`.trim() : body.message ?? "답글 문구를 준비하지 못했습니다.",
        nextAction: skipInfo?.nextAction ?? null,
        targetPrepared: body.targetPrepared === true,
      });
      if (body.outcome === "ready" && body.draft && body.approvalToken) {
        setPrepared({
          topLevelCommentId,
          draft: body.draft,
          approvalToken: body.approvalToken,
        });
      }
      // Refresh counts and halt status after preparation.
      await loadAutoStatus();
    }
    setPrepareBusy(false);
  }

  /**
   * Step two: publish the sentence that is on screen.
   *
   * The request carries the two ids and the approval token, and no text. The
   * sentence comes out of the token's signed payload on the server, so this
   * screen cannot alter what gets published, and what a person read is what
   * goes out byte for byte.
   */
  async function approveAndSend() {
    if (videoCheck?.status !== "ok" || prepared === null) return;
    if (
      !window.confirm(
        "실제 YouTube에 답글 1개가 올라갑니다. 올라간 답글은 이 프로그램이 지울 수 없습니다. 계속할까요?",
      )
    ) {
      return;
    }
    setSendBusy(true);
    setAutoMessage(null);
    const body = await autoReplyRequest<AutoReplyActionResponse>("send", {
      videoId: videoCheck.videoId,
      topLevelCommentId: prepared.topLevelCommentId,
      approvalToken: prepared.approvalToken,
    });
    if (body) {
      setSendResult({
        ok: body.outcome === "sent",
        text: body.message ?? "전송 결과를 확인하지 못했습니다.",
        replyCommentId: body.replyCommentId ?? null,
      });
      // The sentence deliberately stays on screen — a person who just published
      // something should still be able to read exactly what went out. The button
      // is what closes: canApproveSend goes false while a result is showing, so a
      // sent reply cannot be offered twice and a refused one needs a fresh
      // preview rather than a second press.
      await loadAutoStatus();
    }
    setSendBusy(false);
  }

  const geminiIssueReasons =
    reviewStatus === "partial" && items
      ? Array.from(
          new Set(
            items
              .map((item) => item.geminiIssue?.reason)
              .filter((reason): reason is NonNullable<typeof reason> => reason !== undefined),
          ),
        )
      : [];

  const canLoadComments =
    videoCheck?.status === "ok" && videoCheck.channelMatches && videoCheck.commentReadEligible;

  const videoErrorInfo =
    videoCheck?.status === "error" && videoCheck.reason ? VIDEO_ERROR_INFO[videoCheck.reason] : undefined;

  const commentErrorInfo = commentsStatus?.reason ? COMMENT_ERROR_INFO[commentsStatus.reason] : undefined;

  const autoSettings = autoStatus?.status === "ok" ? autoStatus.settings ?? null : null;

  const onScreenVideoId = videoCheck?.status === "ok" ? videoCheck.videoId : null;
  const storedVideoId = autoSettings?.videoId ?? null;
  // A target the server already stored for a DIFFERENT video. Preparing is
  // refused in that state (video_not_approved) rather than silently re-pointed,
  // so the screen says so instead of offering a button that always fails.
  const storedOtherVideo =
    storedVideoId !== null && onScreenVideoId !== null && storedVideoId !== onScreenVideoId;
  // The one state that does outrank a person's approval: a previous send whose
  // result nobody saw. Nothing may go out until a person has checked YouTube.
  const haltedOnUnknown = autoSettings?.stopReason === "result_unknown";

  const approvalTarget =
    items?.find(
      (item) =>
        item.topLevelCommentId === approvalTargetId &&
        item.classification.tier === "AUTO_REPLY_CANDIDATE",
    ) ?? null;

  // Deliberately independent of autoSettings.enabled. Answering one comment by
  // hand is a person's decision about that comment, and the schedule is a
  // separate decision about unattended sending — see the note on
  // sendApprovedReply in src/lib/autoreply/runner.ts.
  const canPrepareApproval =
    onScreenVideoId !== null &&
    canLoadComments &&
    approvalTarget !== null &&
    storedVideoId === onScreenVideoId &&
    autoSettings?.activatedAt != null &&
    !storedOtherVideo &&
    !haltedOnUnknown;
  const canApproveSend =
    prepared !== null &&
    prepared.topLevelCommentId === approvalTargetId &&
    sendResult === null &&
    !haltedOnUnknown;

  const decisionCard = (
    decision && decision.videoId === onScreenVideoId && (
          <div className="approval-card" role="region" aria-label="대상과 예약 실행 확인">
            <h3>{decision.action === "target" ? "답글 대상 확인" : "예약 실행 확인"}</h3>
            <p>대상 영상: {decision.videoId}</p>
            <p>기준 시각: {decision.baseline ? formatTimestamp(decision.baseline) : "처음 대상을 확정하는 서버 시각 · 저장 응답에서 확인"}</p>
            <p>이 설정 요청의 전송: 0건 · 조건에 맞는 댓글을 순서대로 처리</p>
            <p>오늘 전송 확인: {autoStatus?.dayCounts?.sentCount ?? "미확인"}개</p>
            <p>{decision.action === "enable" ? "켜면 기준 시각 이후의 댓글에 예약 전송이 시작됩니다. 꺼져 있던 동안 올라온 댓글도 포함됩니다." : "새 대상이면 예약 실행은 꺼집니다. 이 단계에서는 댓글을 보내지 않습니다."}</p>
            <button onClick={confirmDecision} disabled={autoBusy !== null}>{decision.action === "enable" ? "확인했고 예약 실행 켜기" : "확인했고 답글 대상으로 저장"}</button>
            <button onClick={() => setDecision(null)} disabled={autoBusy !== null}>취소</button>
          </div>
        )
  );

  return (
    <main>
      <header className="brand">
        <Image src="/brand/book-symbol.png" alt="" width={28} height={28} unoptimized />
        <Image src="/brand/repository-title.svg" alt="" width={160} height={28} unoptimized />
      </header>

      <h1>20장. 유튜브 댓글 읽기·분류·초안 미리보기와 답글 보내기</h1>
      <div className="mode-banner" role="status">
        <span>19장 YouTube·Gemini: {CONFIG_STATUS_BANNER[configStatus]}</span>
        <span>20장 상태 저장소: {storeConfigured ? "설정 입력됨 · 실제 확인 전" : "설정 대기 · README의 Supabase 설정 필요"}</span>
        <span>자동답글 기본값 꺼짐 · 승인한 영상만 처리</span>
      </div>

      <section className="panel" aria-labelledby="step1-heading">
        <h2 id="step1-heading">1. 시험 영상 확인</h2>
        <label htmlFor="videoUrl">댓글 실습에 사용할 내 영상 주소</label>
        <input
          id="videoUrl"
          type="text"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
        />
        <button onClick={checkVideo} disabled={videoBusy || videoUrl.trim().length === 0}>
          {videoBusy ? "확인 중..." : "영상·채널 확인"}
        </button>

        {videoClientError && <p className="status-line error">✕ {videoClientError}</p>}

        {videoCheck && (
          <div className={`result-card ${videoCheck.status === "error" ? "error" : "ok"}`}>
            {videoCheck.status === "error" ? (
              <>
                <p>
                  ✕ {videoCheck.target ? `${VIDEO_ERROR_TARGET_LABEL[videoCheck.target]}: ` : ""}
                  {videoErrorInfo?.message ?? videoCheck.message ?? "확인하지 못했습니다."}
                </p>
                <p className="status-line">{videoErrorInfo?.nextAction ?? "다음 행동: 잠시 후 다시 시도하세요."}</p>
              </>
            ) : (
              <>
                <dl className="fact-list">
                  <div>
                    <dt>제목</dt>
                    <dd>{videoCheck.title}</dd>
                  </div>
                  <div>
                    <dt>채널</dt>
                    <dd>{videoCheck.channelTitle}</dd>
                  </div>
                  <div>
                    <dt>공개 범위</dt>
                    <dd>{privacyDisplayLabel(videoCheck.privacyStatus)}</dd>
                  </div>
                  <div>
                    <dt>채널 소유 일치</dt>
                    <dd>
                      {videoCheck.channelMatches
                        ? "✓ 예 — 승인한 채널의 영상입니다."
                        : "✕ 아니오 — 다른 채널의 영상입니다."}
                    </dd>
                  </div>
                  <div>
                    <dt>댓글 조회 진행 가능 여부</dt>
                    <dd>
                      {videoCheck.commentReadEligible
                        ? "✓ 공개 범위 확인됨 — 다음 단계 진행 가능"
                        : "✕ 비공개 등 — 이 영상으로는 진행할 수 없습니다."}
                    </dd>
                  </div>
                </dl>
                <p className="status-line">조회 시각: {formatTimestamp(videoCheck.fetchedAt)}</p>
                <p className="status-line success">✓ 실제 YouTube API 응답으로 확인된 결과입니다.</p>
                {videoCheck.channelMatches && !videoCheck.commentReadEligible && (
                  <p className="status-line error">
                    다음 행동: 공개 또는 일부 공개(unlisted) 상태의 다른 시험 영상을 선택하세요.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="step2-heading">
        <h2 id="step2-heading">2. 공개된 최상위 댓글 읽기 (최신순 최대 20개)</h2>
        <button onClick={loadComments} disabled={!canLoadComments || commentsBusy}>
          {commentsBusy ? "읽는 중..." : "댓글 읽기"}
        </button>
        {!canLoadComments && (
          <p className="status-line">
            채널 일치와 공개(또는 일부 공개) 상태가 모두 확인된 뒤에 읽을 수 있습니다.
          </p>
        )}

        {commentsClientError && <p className="status-line error">✕ {commentsClientError}</p>}

        {commentsStatus && (
          <div className={`result-card ${commentsStatus.status === "error" ? "error" : "ok"}`}>
            {commentsStatus.status === "error" ? (
              <>
                <p>✕ {commentErrorInfo?.message ?? commentsStatus.message ?? "댓글을 읽지 못했습니다."}</p>
                <p className="status-line">{commentErrorInfo?.nextAction ?? "다음 행동: 잠시 후 다시 시도하세요."}</p>
              </>
            ) : (
              <>
                {comments && comments.length === 0 ? (
                  <p>이 영상에는 공개된 최상위 댓글이 0개입니다. (댓글은 켜져 있습니다)</p>
                ) : (
                  <>
                    <p>✓ {commentsStatus.note ?? `최상위 댓글 ${commentsStatus.count ?? comments?.length ?? 0}개를 읽었습니다.`}</p>
                    <p className="status-line">
                      반환 개수: {commentsStatus.count ?? comments?.length ?? 0}개 (최대 20개, 전체 댓글이 아닙니다)
                      {commentsStatus.isPartial && " · 더 많은 댓글이 남아 있어 일부만 조회했습니다."}
                    </p>
                  </>
                )}
                {typeof commentsStatus.skippedCount === "number" && commentsStatus.skippedCount > 0 && (
                  <p className="status-line error">
                    ⚠ 이 도구가 읽을 수 있는 형식이 아닌 항목 {commentsStatus.skippedCount}개는 위 목록에서
                    제외했습니다. 조회 중 삭제된 댓글일 수 있습니다. 다음 행동: YouTube에서 보이는 댓글과
                    대조하세요.
                  </p>
                )}
                <p className="status-line success">✓ 실제 YouTube API 응답으로 확인된 결과입니다.</p>
              </>
            )}
            {commentsStatus.fetchedAt && <p className="status-line">조회 시각: {formatTimestamp(commentsStatus.fetchedAt)}</p>}
          </div>
        )}
      </section>

      {comments && comments.length > 0 && (
        <section className="panel" aria-labelledby="step3-heading">
          <h2 id="step3-heading">3. 분류 · 처리 수준 · 답글 초안 미리보기</h2>
          <button onClick={reviewComments} disabled={reviewBusy}>
            {reviewBusy ? "분류 중..." : "분류·초안 만들기"}
          </button>
          {reviewError && (
            <>
              <p className="status-line error">✕ {reviewError}</p>
              {reviewErrorNextAction && <p className="status-line">{reviewErrorNextAction}</p>}
            </>
          )}

          {reviewStatus === "partial" && (
            <div className="result-card error" role="alert">
              <p>
                ⚠ Gemini 호출 일부가 실패해 해당 댓글을 사람 확인으로 전환했습니다. 이 결과는 실제 Gemini
                성공이 아닙니다 — 아래에 표시된 댓글마다 자동답글 후보로 올리지 않고 안전하게 사람 확인으로만
                남았습니다.
              </p>
              {geminiIssueReasons.map((reason) => {
                const info = GEMINI_ISSUE_INFO[reason];
                return (
                  <p className="status-line" key={reason}>
                    {info?.message ?? "Gemini 호출에 문제가 발생했습니다."} {info?.nextAction ?? "다음 행동: 잠시 후 다시 시도하세요."}
                  </p>
                );
              })}
            </div>
          )}

          <p className="status-line">
            이 단계는 읽기만 합니다. 아래 초안은 화면에서만 보는 것이고, 실제로 보낼 문장은 4단계에서 서버가
            따로 준비합니다.
          </p>

          {items && (
            <div className="review-grid">
              {items.map((item) => {
                return (
                  <article key={item.topLevelCommentId} className="review-card">
                    <div className="review-card-badges">
                      <span className="tag category">{CATEGORY_LABEL[item.classification.category] ?? item.classification.category}</span>
                      <span className={`tag ${TIER_CLASS[item.classification.tier]}`}>
                        {TIER_SYMBOL[item.classification.tier]} {TIER_LABEL[item.classification.tier]}
                      </span>
                      {item.geminiIssue && (
                        <span className="tag human">
                          ⚠ {GEMINI_ISSUE_STAGE_LABEL[item.geminiIssue.stage] ?? item.geminiIssue.stage} ·{" "}
                          {GEMINI_ISSUE_INFO[item.geminiIssue.reason]?.label ?? "Gemini 오류"}
                        </span>
                      )}
                    </div>
                    <p className="review-card-original">{item.text}</p>
                    <p className="status-line">{item.classification.reason}</p>
                    {item.draft ? (
                      <div className="review-card-draft">
                        <strong>초안</strong>
                        <p>{item.draft}</p>
                      </div>
                    ) : (
                      <p className="status-line">
                        초안 없음 — 현재 처리 수준은 {TIER_LABEL[item.classification.tier]}입니다. 이 처리
                        수준에서는 초안을 만들지 않거나, 초안 생성·검사에 실패해 사람 확인으로 전환되었습니다.
                      </p>
                    )}
                    {item.verification && (
                      <div className="review-card-verification">
                        <p>
                          {item.verification.aiCheck.passed ? "✓" : "✕"} AI 문맥 검사
                          {item.verification.aiCheck.reason ? ` — ${item.verification.aiCheck.reason}` : ""}
                        </p>
                        <p>
                          {item.verification.programCheck.passed ? "✓" : "✕"} 프로그램 검사
                          {item.verification.programCheck.failures.length > 0
                            ? ` — ${item.verification.programCheck.failures.join(", ")}`
                            : ""}
                        </p>
                      </div>
                    )}
                    {item.classification.tier === "AUTO_REPLY_CANDIDATE" && (
                      <div className="review-card-pick">
                        <button
                          onClick={() => selectApprovalTarget(item.topLevelCommentId)}
                          disabled={prepareBusy || sendBusy}
                        >
                          {approvalTargetId === item.topLevelCommentId
                            ? "✓ 4단계 승인 대상"
                            : "4단계 승인 대상으로 선택"}
                        </button>
                        <p className="status-line">
                          선택은 이 화면 안에서만 일어납니다. 아무것도 보내지 않습니다.
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <section className="panel" aria-labelledby="step4-heading">
        <h2 id="step4-heading">4. 답글 1개 준비 · 사람 승인 · 전송 (예약 실행과 별개)</h2>
        <p className="status-line">
          여기서부터는 미리보기가 아닙니다. 고른 댓글 1개에 대해 서버가 보낼 문장을 먼저 준비해 보여 주고,
          사람이 승인하면 화면에 보이는 그 문장이 글자 그대로 올라갑니다. 5단계의 예약 실행을 한 번도 켜지
          않아도 이 승인 전송은 할 수 있습니다.
        </p>

        <div className="button-row">
          <button onClick={() => reviewDecision("target")} disabled={!canLoadComments || autoBusy !== null || prepareBusy || sendBusy}>
            이 영상을 답글 대상으로 정하기 (전송 0건)
          </button>
        </div>
        <p className="status-line">처음 대상을 정하면 이때 채널·영상·기준 시각이 저장됩니다. 예약 실행은 켜지지 않습니다. 다른 영상으로 바꾸면 기존 예약 실행도 꺼집니다.</p>
        {decision?.action === "target" && decisionCard}
        {targetNotice && <p className="status-line success">{targetNotice}</p>}
        {autoSettings?.videoId === onScreenVideoId && autoSettings?.activatedAt && <p className="status-line">대상 영상: {onScreenVideoId} · 기준 시각: {formatTimestamp(autoSettings.activatedAt)}</p>}

        {approvalTarget === null ? (
          <p className="status-line">
            3단계에서 자동답글 후보로 분류된 댓글 중 하나를 “4단계 승인 대상으로 선택”하세요. 그 댓글에 대해서만
            문장을 준비할 수 있습니다.
          </p>
        ) : (
          <div className="approval-card">
            <p className="status-line">승인 대상으로 고른 댓글</p>
            <p className="approval-comment">{approvalTarget.text}</p>

            {storedVideoId === onScreenVideoId && autoSettings?.activatedAt && <button
              onClick={() => prepareApproval(approvalTarget.topLevelCommentId)}
              disabled={!canPrepareApproval || prepareBusy || sendBusy}
            >
              {prepareBusy ? "준비 중..." : "보낼 문장 준비하기 (아직 보내지 않음)"}
            </button>}
            <p className="status-line">
              준비는 아무것도 보내지 않습니다. 먼저 답글 대상을 정한 뒤, 기준 시각 이후에 새로 올라온 댓글을 선택하세요.
            </p>

            {prepareResult && (
              <>
                <p className={`status-line ${prepareResult.ok ? "success" : "error"}`}>
                  {prepareResult.ok ? "✓" : "✕"} {prepareResult.text}
                </p>
                {prepareResult.nextAction && (
                  <p className="status-line">{prepareResult.nextAction}</p>
                )}
                {prepareResult.targetPrepared && (
                  <p className="status-line">
                    이 영상을 답글 대상으로 저장했습니다. 기준 시각 이후에 올라온 댓글만 대상이 되므로, 그
                    전에 있던 댓글에는 이 프로그램이 답글을 보내지 않습니다.
                  </p>
                )}
              </>
            )}

            {prepared && (
              <div className="approval-sentence">
                <strong>이 문장이 그대로 올라갑니다</strong>
                <p>{prepared.draft}</p>
              </div>
            )}

            {prepared && (
              <div className="approval-actions">
                <button className="send" onClick={approveAndSend} disabled={!canApproveSend || sendBusy}>
                  {sendBusy ? "보내는 중..." : "위 문장을 승인하고 답글 1개 보내기"}
                </button>
                <p className="status-line">
                  승인 정보는 10분이 지나면 만료되고, 그 사이 댓글이 수정되면 무효가 됩니다. 그때는 다시
                  준비해 새 문장을 확인하세요.
                </p>
              </div>
            )}

            {sendResult && (
              <p className={`status-line ${sendResult.ok ? "success" : "error"}`}>
                {sendResult.ok ? "✓" : "✕"} {sendResult.text}
              </p>
            )}

            {!canLoadComments && (
              <p className="status-line error">
                1단계에서 채널 일치와 공개 범위가 확인된 영상에서만 준비할 수 있습니다.
              </p>
            )}
            {storedOtherVideo && (
              <p className="status-line error">
                ✕ 이미 다른 영상({storedVideoId})이 답글 대상으로 저장되어 있습니다. 다음 행동: 저장된 그
                영상으로 진행하거나, 4단계에서 이 영상으로 답글 대상을 다시 정하세요.
              </p>
            )}
            {haltedOnUnknown && (
              <p className="status-line error">
                ✕ 이전 전송의 결과를 확인하지 못해 멈춘 상태입니다. 사람이 승인해도 보내지 않습니다. 다음
                행동: YouTube에서 답글이 올라갔는지 직접 확인한 뒤 5단계에서 상태를 확인하세요.
              </p>
            )}

            <details className="detail">
              <summary>이 승인의 id와 기준 시각</summary>
              <ul className="record-list">
                <li>댓글 id: {approvalTarget.topLevelCommentId}</li>
                <li>영상 id: {onScreenVideoId ?? "없음"}</li>
                <li>
                  저장된 답글 대상 영상: {storedVideoId ?? "없음"} · 기준 시각{" "}
                  {autoSettings?.activatedAt ? formatTimestamp(autoSettings.activatedAt) : "없음"}
                </li>
                {sendResult?.replyCommentId && <li>올라간 답글 id: {sendResult.replyCommentId}</li>}
              </ul>
            </details>
          </div>
        )}
      </section>

      <section className="panel" aria-labelledby="step5-heading">
        <h2 id="step5-heading">5. 예약 실행 자동답글 (기본값: 꺼짐)</h2>
        <p className="status-line">
          이것은 4단계와 다른 결정입니다. 켜면 사람이 보지 않는 사이에도 정해진 시각에 실행됩니다. 처음 대상을 준비할 때 정한 기준 시각 이후에 올라온 새 최상위 댓글만 대상이 됩니다.{" "}
          실행 시간 안에서 조건에 맞는 댓글을 순서대로 처리합니다. 질문·사실 정정·광고와 판단이
          애매한 댓글은 자동으로 보내지 않습니다.
        </p>
        <div className="button-row">
          <button onClick={refreshAutoStatus} disabled={autoBusy !== null || prepareBusy || sendBusy}>
            {autoBusy === "status" ? "확인 중..." : "상태 확인"}
          </button>
          <button
            onClick={() => reviewDecision("enable")}
            disabled={autoBusy !== null || prepareBusy || sendBusy || !canLoadComments || storedVideoId !== onScreenVideoId || haltedOnUnknown}
          >
            {autoBusy === "enable" ? "켜는 중..." : "이 영상으로 예약 실행 켜기"}
          </button>
          <button
            className="danger"
            onClick={turnOffAutoReply}
            disabled={autoBusy !== null || prepareBusy || sendBusy}
          >
            {autoBusy === "stop" ? "끄는 중..." : "예약 실행 끄기"}
          </button>
        </div>
        <p className="status-line">
          끄기는 예약 실행만 멈춥니다. 4단계의 사람 승인 전송은 그 뒤에도 할 수 있습니다 — 다만 전송 결과를
          확인하지 못해 스스로 멈춘 상태라면 그것마저 보내지 않습니다.
        </p>
        {!canLoadComments && (
          <p className="status-line">
            1단계에서 채널 일치와 공개 범위가 확인된 영상만 켤 수 있습니다.
          </p>
        )}
        {autoMessage && (
          <p className={`status-line ${autoMessage.ok ? "success" : "error"}`}>
            {autoMessage.ok ? "✓" : "✕"} {autoMessage.text}
          </p>
        )}

        {decision?.action === "enable" && decisionCard}

        {autoStatus && (
          <div className={`result-card ${autoStatus.status === "error" ? "error" : "ok"}`}>
            {autoStatus.status === "error" || !autoSettings ? (
              <p>✕ {autoStatus.message ?? "자동답글 상태를 확인하지 못했습니다."}</p>
            ) : (
              <>
                <dl className="fact-list">
                  <div>
                    <dt>예약 실행</dt>
                    <dd>{autoSettings.enabled ? "✓ 켜짐" : "✕ 꺼짐"}</dd>
                  </div>
                  <div>
                    <dt>답글 대상 영상</dt>
                    <dd>{autoSettings.videoId ?? "없음"}</dd>
                  </div>
                  <div>
                    <dt>기준 시각 (이 시각 이후 댓글만 대상)</dt>
                    <dd>{autoSettings.activatedAt ? formatTimestamp(autoSettings.activatedAt) : "없음"}</dd>
                  </div>
                  <div>
                    <dt>오늘 사용 ({autoStatus.sendDay ?? "-"} · Asia/Seoul)</dt>
                    <dd>

                      전송 확인 {autoStatus.dayCounts?.sentCount ?? 0}개
                    </dd>
                  </div>
                </dl>
                {!autoSettings.enabled && autoSettings.stopReason && (
                  <p className="status-line">
                    멈춘 이유: {STOP_REASON_LABEL[autoSettings.stopReason] ?? "사람이 확인해야 합니다."}
                    {autoSettings.stoppedAt ? ` (${formatTimestamp(autoSettings.stoppedAt)})` : ""}
                  </p>
                )}
                {!autoSettings.enabled && autoSettings.videoId !== null && !haltedOnUnknown && (
                  <p className="status-line">
                    예약 실행이 꺼져 있어도 답글 대상은 저장된 상태입니다. 4단계의 사람 승인 전송은 이 상태에서
                    바로 할 수 있습니다.
                  </p>
                )}
                <h3>최근 실행</h3>
                {autoStatus.recentRuns?.[0] ? <p className="status-line">
                  {autoStatus.recentRuns[0].trigger === "scheduled" ? "예약 실행" : "사람 승인 실행"} · {autoStatus.recentRuns[0].completedAt ? `완료 ${formatTimestamp(autoStatus.recentRuns[0].completedAt)}` : "완료 시각 없음 · 실행 중 또는 중단됨"} · 전송 {autoStatus.recentRuns[0].sentCount}건
                  {autoStatus.recentRuns[0].failureCount > 0 || autoStatus.recentRuns[0].outcome === "run_failed" ? " · 오류 확인 필요" : ""}
                </p> : <p className="status-line">실행 기록이 없습니다. 예약 등록이나 전송 성공을 뜻하지 않습니다.</p>}
                <details className="detail">
                  <summary>최근 실행의 확인 근거 자세히 보기</summary>
                  <p className="status-line">후보는 이번 실행에서 검토한 댓글 수입니다. 완료 시각 없음은 실행 중이거나 중간에 종료되어 완료를 확인하지 못한 상태입니다.</p>
                  <ul className="record-list">{autoStatus.recentRuns?.map(run => <li key={run.runId}>
                    {run.trigger === "scheduled" ? "예약" : "수동"} · run id: {run.runId}<br />
                    시작: {formatTimestamp(run.startedAt)} · 완료: {run.completedAt ? formatTimestamp(run.completedAt) : "완료 시각 없음"}<br />
                    outcome: {run.outcome ?? "미완료"} · 후보 {run.consideredCount} · 사람 확인 {run.humanReviewCount} · 실패 {run.failureCount} · 전송 {run.sentCount}
                  </li>)}</ul>
                </details>
                <p className="status-line">
                  {autoStatus.recentSends && autoStatus.recentSends.length > 0
                    ? `전송 기록 ${autoStatus.recentSends.length}건이 있습니다.`
                    : "전송 기록이 없습니다."}
                </p>
                <details className="detail">
                  <summary>전송 기록과 id 자세히 보기</summary>
                  {autoStatus.recentSends && autoStatus.recentSends.length > 0 ? (
                    <ul className="record-list">
                      {autoStatus.recentSends.map((record) => (
                        <li key={record.topLevelCommentId}>
                          {record.sendDay} · 댓글 {record.topLevelCommentId} ·{" "}
                          {SEND_STATUS_LABEL[record.status] ?? record.status}
                          {record.replyCommentId ? ` · 답글 id ${record.replyCommentId}` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="status-line">남은 기록이 없습니다.</p>
                  )}
                  <p className="status-line">
                    기록에는 댓글 내용·작성자·답글 내용이 없습니다. id와 상태, 시각만 남습니다. 30일이 지난 기록은 다음 예약 호출 때 삭제됩니다. 예약을 완전히 없앴다면 직접 정리해야 합니다.
                  </p>
                  <p className="status-line">
                    채널 id: {autoSettings.channelId ?? "없음"} · 껐다면 그 시각{" "}
                    {autoSettings.stoppedAt ? formatTimestamp(autoSettings.stoppedAt) : "없음"}
                  </p>
                </details>
              </>
            )}
          </div>
        )}
      </section>

      <p className="status-line footer-note">
        1~3단계 미리보기는 내 컴퓨터에서만 열리고, 배포한 서버에서는 닫힙니다. 댓글을 쓰는 호출은 4단계의
        사람 승인 전송과 5단계의 예약 실행뿐이고, 둘 다 답글 1개를 올리는 같은 호출 하나만 씁니다. 올라간
        답글은 이 프로그램이 지울 수 없습니다.
      </p>
    </main>
  );
}
