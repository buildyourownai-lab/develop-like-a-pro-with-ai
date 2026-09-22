import { jsonResponse } from "@/lib/http";
import { blockPreviewInProduction } from "@/lib/autoreply/runtime-guard";
import { createRealYoutubeClient } from "@/lib/youtube/real-client";
import { checkOwnership } from "@/lib/youtube/ownership";
import { isCommentReadEligiblePrivacy } from "@/lib/youtube/types";
import { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } from "@/lib/youtube/error-classification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reads up to 20 newest public/unlisted top-level comments for one
 * already-owned video via commentThreads.list. Ownership and privacy are
 * re-checked here on every call — a private, unconfirmed, or unrecognized
 * privacy video is BLOCKED before commentThreads.list is ever called.
 * This route returns other people's comment text, so it is closed in
 * production — see src/lib/autoreply/runtime-guard.ts. Reading originals stays
 * on the channel owner's own machine.
 *
 * There is no write path here. The project's single write call lives in
 * src/lib/youtube/reply-client.ts and is never reached from this route;
 * comments.update / delete / setModerationStatus are never called at all.
 *
 * `invalid_response`/`network_error` results carry a raw diagnostic
 * message from the client (HTTP status text, a JSON parse failure, or a
 * thrown fetch error) that may embed internal detail such as a local
 * path. That raw message is never forwarded to the browser — only the
 * fixed, safe Korean text from YOUTUBE_LOOKUP_ERROR_MESSAGE is.
 */
export async function POST(request: Request) {
  const blocked = blockPreviewInProduction();
  if (blocked !== null) return blocked;

  let videoId: unknown;
  try {
    const body = await request.json();
    videoId = (body as { videoId?: unknown }).videoId;
  } catch {
    return jsonResponse({ status: "error", message: "요청 본문을 읽을 수 없습니다." }, 400);
  }

  if (typeof videoId !== "string" || videoId.trim().length === 0) {
    return jsonResponse({ status: "error", message: "videoId가 필요합니다." }, 400);
  }

  const client = createRealYoutubeClient();

  try {
    const ownership = await checkOwnership(client, videoId);
    if (!ownership.channelMatches) {
      return jsonResponse(
        {
          status: "error",
          reason: "channel_mismatch",
          message: "이 영상은 연결된 계정의 채널 소유가 아닙니다. 본인 채널의 시험 영상을 선택하세요.",
        },
        403,
      );
    }
    if (!isCommentReadEligiblePrivacy(ownership.video.privacyStatus)) {
      return jsonResponse(
        {
          status: "error",
          reason: "privacy_blocked",
          message:
            "이 영상은 비공개이거나 공개 범위를 확인할 수 없습니다. 공개 또는 일부 공개(unlisted) 상태의 다른 시험 영상을 선택하세요.",
          privacyStatus: ownership.video.privacyStatus,
        },
        403,
      );
    }
  } catch (error) {
    const classified = classifyYoutubeLookupError(error);
    const reason = classified === "lookup_failed" ? "ownership_check_failed" : `ownership_${classified}`;
    return jsonResponse(
      {
        status: "error",
        reason,
        message: YOUTUBE_LOOKUP_ERROR_MESSAGE[classified],
      },
      502,
    );
  }

  try {
    const result = await client.listTopLevelComments(videoId);

    switch (result.kind) {
      case "ok":
        return jsonResponse({
          status: "ok",
          reason: "listed",
          comments: result.comments,
          count: result.comments.length,
          // Items YouTube returned that this app could not read (e.g. a comment
          // deleted mid-request). Passed on so the screen can say so instead of
          // showing a quietly shortened list.
          skippedCount: result.skippedCount,
          isPartial: result.nextPageToken !== null,
          fetchedAt: new Date().toISOString(),
          note: "최상위 댓글 최신순 최대 20개만 읽었습니다. 전체 댓글을 확인한 것은 아닙니다.",
        });
      case "empty":
        return jsonResponse({
          status: "ok",
          reason: "empty",
          comments: [],
          count: 0,
          isPartial: false,
          fetchedAt: new Date().toISOString(),
        });
      case "disabled":
        return jsonResponse(
          { status: "error", reason: "comments_disabled", comments: [] },
          200,
        );
      case "video_not_found":
        return jsonResponse(
          {
            status: "error",
            reason: "video_not_found",
            message: YOUTUBE_LOOKUP_ERROR_MESSAGE.video_not_found,
            comments: [],
          },
          404,
        );
      case "forbidden":
        return jsonResponse(
          { status: "error", reason: "forbidden", comments: [] },
          403,
        );
      case "auth_error":
        return jsonResponse(
          { status: "error", reason: "auth_error", comments: [] },
          401,
        );
      case "quota_exceeded":
        return jsonResponse(
          { status: "error", reason: "quota_exceeded", comments: [] },
          429,
        );
      case "invalid_response":
        return jsonResponse(
          {
            status: "error",
            reason: "invalid_response",
            message: YOUTUBE_LOOKUP_ERROR_MESSAGE.invalid_response,
            comments: [],
          },
          502,
        );
      case "network_error":
        return jsonResponse(
          {
            status: "error",
            reason: "network_error",
            message: YOUTUBE_LOOKUP_ERROR_MESSAGE.network_error,
            comments: [],
          },
          502,
        );
    }
  } catch (error) {
    // A setup/credential failure thrown out of the list call (see
    // listTopLevelComments) is classified by type so the reader is told what
    // to fix, instead of a blanket "예상하지 못한 오류". Only a genuinely
    // unrecognized error falls through to 500.
    const classified = classifyYoutubeLookupError(error);
    if (classified === "lookup_failed") {
      return jsonResponse(
        { status: "error", reason: "unexpected_error", message: "댓글을 읽는 중 예상하지 못한 오류가 발생했습니다.", comments: [] },
        500,
      );
    }
    return jsonResponse(
      {
        status: "error",
        reason: classified,
        message: YOUTUBE_LOOKUP_ERROR_MESSAGE[classified],
        comments: [],
      },
      502,
    );
  }
}
