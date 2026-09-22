import { CommentsListResult, VideoLookup, YoutubeClient } from "./types";
import { YoutubeSchemaError, parseCommentThreads, parseMyChannelId, parseVideoLookup } from "./schema";
import { authedGet, readApiErrorReason } from "./api";
import {
  YoutubeAuthError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeInvalidResponseError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
} from "./errors";

/**
 * Read-only YouTube Data API v3 client — chapter 19's reading, classification
 * and preview path, unchanged. Every request below uses GET. There is no
 * write method on YoutubeClient and none is added here.
 *
 * Chapter 20's single write method (comments.insert) lives in a separate
 * file, src/lib/youtube/reply-client.ts, precisely so that this client stays
 * provably read-only and the write surface stays one file wide.
 *
 * Credentials and the access token come from src/lib/youtube/auth.ts, shared
 * with the reply client so one refresh token file is reused.
 */

async function throwForFailedListResponse(response: Response, endpointLabel: string): Promise<never> {
  const reason = await readApiErrorReason(response);
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
    throw new YoutubeQuotaExceededError(`${endpointLabel} quota exceeded (status ${response.status})`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new YoutubeAuthError(`${endpointLabel} failed with status ${response.status}`);
  }
  throw new Error(`${endpointLabel} failed with status ${response.status}`);
}

async function getMyChannelId(): Promise<string> {
  const response = await authedGet("/channels", { part: "id", mine: "true" });
  if (!response.ok) {
    return throwForFailedListResponse(response, "channels.list");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("channels.list 응답을 JSON으로 읽지 못했습니다.");
  }
  return parseMyChannelId(body);
}

async function getVideo(videoId: string): Promise<VideoLookup> {
  const response = await authedGet("/videos", {
    part: "snippet,status",
    id: videoId,
  });
  if (!response.ok) {
    return throwForFailedListResponse(response, "videos.list");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("videos.list 응답을 JSON으로 읽지 못했습니다.");
  }
  return parseVideoLookup(body);
}

async function listTopLevelComments(
  videoId: string,
  pageToken?: string,
): Promise<CommentsListResult> {
  let response: Response;
  try {
    response = await authedGet("/commentThreads", {
      part: "snippet",
      videoId,
      order: "time",
      // 20 newest top-level comments in one page, the same cap chapter 19
      // established. src/lib/autoreply/policy.ts re-states this number as
      // MAX_COMMENTS_PER_RUN and its test asserts the two agree.
      maxResults: "20",
      textFormat: "plainText",
      // Only sent when continuing a walk a previous run started. An empty or
      // absent token means "the newest page", which is what chapter 19's
      // preview always asks for.
      ...(pageToken !== undefined && pageToken.length > 0 ? { pageToken } : {}),
    });
  } catch (error) {
    // The access token is fetched inside authedGet, so a local setup problem
    // (unset env var, unreadable credential file, a token whose granted scope
    // is not exactly force-ssl, a malformed refresh response) surfaces here
    // too. Reporting those as "통신 실패" would send the reader to check their
    // internet connection for a problem that is in their own configuration,
    // so they are rethrown for the route to classify by type. Anything else
    // coming out of fetch really is a transport failure.
    if (
      error instanceof YoutubeConfigMissingError ||
      error instanceof YoutubeCredentialFileError ||
      error instanceof YoutubeScopeInsufficientError ||
      error instanceof YoutubeInvalidResponseError
    ) {
      throw error;
    }
    if (error instanceof YoutubeAuthError) {
      return { kind: "auth_error" };
    }
    if (error instanceof YoutubeQuotaExceededError) {
      return { kind: "quota_exceeded" };
    }
    return {
      kind: "network_error",
      message: error instanceof Error ? error.message : "unknown network error",
    };
  }

  if (!response.ok) {
    const reason = await readApiErrorReason(response);
    if (reason === "commentsDisabled") {
      return { kind: "disabled" };
    }
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded" || reason === "rateLimitExceeded") {
      return { kind: "quota_exceeded" };
    }
    // The video is gone or no longer visible — it may have been deleted or
    // switched to private between the ownership check and this call.
    if (response.status === 404) {
      return { kind: "video_not_found" };
    }
    if (response.status === 401) {
      return { kind: "auth_error" };
    }
    if (response.status === 403) {
      return { kind: "forbidden" };
    }
    return { kind: "network_error", message: `HTTP ${response.status}${reason ? ` (${reason})` : ""}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { kind: "invalid_response", message: "commentThreads.list 응답을 JSON으로 읽지 못했습니다." };
  }

  let parsed;
  try {
    parsed = parseCommentThreads(body);
  } catch (error) {
    if (error instanceof YoutubeSchemaError) {
      return { kind: "invalid_response", message: error.message };
    }
    throw error;
  }

  if (parsed.comments.length === 0) {
    // Items came back but not one of them could be read: that is a response
    // this app failed to understand, not "이 영상에는 댓글이 0개".
    if (parsed.skippedCount > 0) {
      return {
        kind: "invalid_response",
        message: `commentThreads.list 항목 ${parsed.skippedCount}개를 모두 읽지 못했습니다.`,
      };
    }
    return { kind: "empty" };
  }

  return {
    kind: "ok",
    comments: parsed.comments,
    skippedCount: parsed.skippedCount,
    nextPageToken: parsed.nextPageToken,
  };
}

export function createRealYoutubeClient(): YoutubeClient {
  return { getMyChannelId, getVideo, listTopLevelComments };
}
