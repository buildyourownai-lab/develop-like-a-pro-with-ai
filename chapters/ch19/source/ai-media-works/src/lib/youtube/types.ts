import { FetchedComment } from "../comments/types";

export interface VideoLookup {
  videoId: string;
  title: string;
  channelId: string;
  channelTitle: string;
  privacyStatus: string;
  /** null when the API response did not make this observable. */
  commentsEnabledHint: boolean | null;
}

export interface OwnershipCheck {
  video: VideoLookup;
  myChannelId: string;
  channelMatches: boolean;
}

/**
 * Only these two privacy states are eligible for the comment-reading
 * exercise. private and made-for-kids-implied-private videos, and any
 * privacy value this app does not recognize, must block before
 * commentThreads.list is ever called — see isCommentReadEligiblePrivacy.
 */
export const COMMENT_ELIGIBLE_PRIVACY_STATUSES = ["public", "unlisted"] as const;

export function isCommentReadEligiblePrivacy(privacyStatus: string): boolean {
  return (COMMENT_ELIGIBLE_PRIVACY_STATUSES as readonly string[]).includes(privacyStatus);
}

export type CommentsListResult =
  | {
      kind: "ok";
      comments: FetchedComment[];
      /** Returned items this app could not read — disclosed, never silently dropped. */
      skippedCount: number;
      nextPageToken: string | null;
    }
  | { kind: "empty" }
  | { kind: "disabled" }
  | { kind: "video_not_found" }
  | { kind: "forbidden" }
  | { kind: "auth_error" }
  | { kind: "quota_exceeded" }
  | { kind: "invalid_response"; message: string }
  | { kind: "network_error"; message: string };

export interface YoutubeClient {
  getMyChannelId(): Promise<string>;
  getVideo(videoId: string): Promise<VideoLookup>;
  /** commentThreads.list — public top-level comments only, newest first, max 20. */
  listTopLevelComments(videoId: string): Promise<CommentsListResult>;
}
