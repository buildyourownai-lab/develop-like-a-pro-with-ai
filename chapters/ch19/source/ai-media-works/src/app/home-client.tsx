"use client";

import { useState } from "react";
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
    message: "설정된 인증 파일을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 설정된 두 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)와 README를 확인하세요.",
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
    message: "설정된 인증 파일을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 설정된 두 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)와 README를 확인하세요.",
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
    message: "설정된 인증 파일을 읽거나 형식을 확인하지 못했습니다.",
    nextAction:
      "다음 행동: 설정된 두 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)와 README를 확인하세요.",
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

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("ko-KR");
  } catch {
    return iso;
  }
}

export default function HomeClient({ configStatus }: { configStatus: ConfigStatus }) {
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

  // A new video check or comments load invalidates any prior review — clear
  // the whole downstream state together so a stale partial/error warning
  // from the previous batch can never outlive it.
  function resetReviewState() {
    setItems(null);
    setReviewStatus(null);
    setReviewError(null);
    setReviewErrorNextAction(null);
  }

  async function checkVideo() {
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

  return (
    <main>
      <header className="brand">
        <Image src="/brand/book-symbol.png" alt="" width={28} height={28} unoptimized />
        <Image src="/brand/repository-title.svg" alt="" width={160} height={28} unoptimized />
      </header>

      <h1>19장. 유튜브 댓글 읽기·분류·초안 미리보기</h1>
      <div className="mode-banner" role="status">
        <span>{CONFIG_STATUS_BANNER[configStatus]}</span>
        <span>로컬 미리보기 · YouTube 전송 없음</span>
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

          {items && (
            <div className="review-grid">
              {items.map((item) => (
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
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      <p className="status-line footer-note">
        이 화면은 내 컴퓨터에서만 실행됩니다. 이 프로젝트에는 보내기 버튼이나 댓글 작성 API가 없습니다 — YouTube 전송 없음.
      </p>
    </main>
  );
}
