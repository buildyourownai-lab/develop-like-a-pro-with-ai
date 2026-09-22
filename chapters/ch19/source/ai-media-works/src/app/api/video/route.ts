import { jsonResponse } from "@/lib/http";
import { createRealYoutubeClient } from "@/lib/youtube/real-client";
import { extractVideoId } from "@/lib/youtube/video-id";
import { isCommentReadEligiblePrivacy } from "@/lib/youtube/types";
import {
  classifyYoutubeLookupError,
  YOUTUBE_LOOKUP_ERROR_MESSAGE,
  type YoutubeLookupErrorReason,
} from "@/lib/youtube/error-classification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "There is no such video" / "this account has no channel" are answers, not
 * gateway failures — 404 keeps them distinguishable from a broken lookup.
 */
function statusForLookupReason(reason: YoutubeLookupErrorReason): number {
  return reason === "video_not_found" || reason === "channel_not_found" ? 404 : 502;
}

/**
 * Resolves a video URL to its owning channel and compares it against the
 * connected account's own channel. This never changes privacy, comment, or
 * made-for-kids settings — it only reads what is already there.
 *
 * A failed lookup returns status:"error" with a reason from a small closed
 * set, never the raw error message — that message can name an unset env
 * var, a local file path, or internal HTTP client wording, none of which
 * belongs in the browser.
 */
export async function POST(request: Request) {
  try {
    let videoUrl: unknown;
    try {
      const body = await request.json();
      videoUrl = (body as { videoUrl?: unknown }).videoUrl;
    } catch {
      return jsonResponse({ status: "error", message: "요청 본문을 읽을 수 없습니다." }, 400);
    }

    if (typeof videoUrl !== "string" || videoUrl.trim().length === 0) {
      return jsonResponse({ status: "error", message: "videoUrl이 필요합니다." }, 400);
    }

    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return jsonResponse(
        { status: "error", message: "이 주소에서 영상 ID를 확인하지 못했습니다." },
        400,
      );
    }

    const client = createRealYoutubeClient();

    let video;
    try {
      video = await client.getVideo(videoId);
    } catch (error) {
      const reason = classifyYoutubeLookupError(error);
      return jsonResponse(
        { status: "error", target: "video", reason, message: YOUTUBE_LOOKUP_ERROR_MESSAGE[reason] },
        statusForLookupReason(reason),
      );
    }

    let myChannelId: string;
    try {
      myChannelId = await client.getMyChannelId();
    } catch (error) {
      const reason = classifyYoutubeLookupError(error);
      return jsonResponse(
        { status: "error", target: "channel", reason, message: YOUTUBE_LOOKUP_ERROR_MESSAGE[reason] },
        statusForLookupReason(reason),
      );
    }

    return jsonResponse({
      status: "ok",
      videoId,
      title: video.title,
      channelTitle: video.channelTitle,
      privacyStatus: video.privacyStatus,
      commentReadEligible: isCommentReadEligiblePrivacy(video.privacyStatus),
      channelMatches: video.channelId === myChannelId,
      myChannelId,
      fetchedAt: new Date().toISOString(),
    });
  } catch {
    return jsonResponse(
      { status: "error", reason: "unexpected_error", message: "예상하지 못한 오류로 영상 확인에 실패했습니다." },
      500,
    );
  }
}
