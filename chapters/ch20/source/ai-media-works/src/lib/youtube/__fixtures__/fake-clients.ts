import { FetchedComment } from "../../comments/types";
import { InsertReplyResult, ListRepliesResult, ReplyClient } from "../reply-types";
import { CommentsListResult, VideoLookup, YoutubeClient } from "../types";

/**
 * Scripted stand-ins for the two YouTube clients, used only in tests.
 *
 * Neither one touches the network. Between these and FakeAutoReplyStore, every
 * chapter 20 rule can be exercised without a single real API call — which
 * matters most for the write path, since a test that actually sent a reply
 * would be posting to a real person's video.
 */

export function fakeVideo(overrides: Partial<VideoLookup> = {}): VideoLookup {
  return {
    videoId: "VIDEO_1",
    title: "테스트용 영상",
    channelId: "UC_MINE",
    channelTitle: "내 채널",
    privacyStatus: "public",
    commentsEnabledHint: true,
    ...overrides,
  };
}

export function fakeComment(overrides: Partial<FetchedComment> = {}): FetchedComment {
  return {
    authorChannelId: "UC_VIEWER",
    threadId: "THREAD_1",
    topLevelCommentId: "COMMENT_1",
    text: "잘 봤습니다.",
    publishedAt: "2026-09-14T00:00:00.000Z",
    ...overrides,
  };
}

export interface FakeYoutubeScript {
  myChannelId?: string;
  video?: VideoLookup;
  /** Thrown by getVideo, to exercise the re-verification failure path. */
  videoError?: Error;
  comments?: CommentsListResult;
  /**
   * Pages keyed by the token used to ask for them, with "" for the newest page.
   * Only needed by the tests about continuing past the first page; everything
   * else uses `comments` and gets the same page whatever the token.
   */
  commentPages?: Record<string, CommentsListResult>;
}

export class FakeYoutubeClient implements YoutubeClient {
  readonly getVideoCalls: string[] = [];
  readonly listCalls: string[] = [];
  /** The page token each list call asked with, "" when it asked for the newest. */
  readonly listPageTokens: string[] = [];

  constructor(private readonly script: FakeYoutubeScript = {}) {}

  async getMyChannelId(): Promise<string> {
    return this.script.myChannelId ?? "UC_MINE";
  }

  async getVideo(videoId: string): Promise<VideoLookup> {
    this.getVideoCalls.push(videoId);
    if (this.script.videoError !== undefined) {
      throw this.script.videoError;
    }
    return this.script.video ?? fakeVideo({ videoId });
  }

  async listTopLevelComments(videoId: string, pageToken?: string): Promise<CommentsListResult> {
    this.listCalls.push(videoId);
    const token = pageToken ?? "";
    this.listPageTokens.push(token);
    const pages = this.script.commentPages;
    if (pages !== undefined) {
      // An unscripted token models a token the API no longer accepts.
      return pages[token] ?? { kind: "invalid_response", message: "unknown page token" };
    }
    return this.script.comments ?? { kind: "empty" };
  }
}

export interface FakeReplyScript {
  /** Called for each insert attempt, in order, so a test can vary the outcome. */
  insert?: (input: { parentCommentId: string; text: string }) => InsertReplyResult | Promise<InsertReplyResult>;
  listReplies?: (parentCommentId: string) => ListRepliesResult | Promise<ListRepliesResult>;
}

export class FakeReplyClient implements ReplyClient {
  readonly insertCalls: Array<{ parentCommentId: string; text: string }> = [];
  readonly expectedSendDays: Array<string | undefined> = [];
  readonly listCalls: string[] = [];

  constructor(private readonly script: FakeReplyScript = {}) {}

  async insertReply(input: { parentCommentId: string; text: string; expectedSendDay?: string }): Promise<InsertReplyResult> {
    this.insertCalls.push({ parentCommentId: input.parentCommentId, text: input.text });
    this.expectedSendDays.push(input.expectedSendDay);
    if (this.script.insert === undefined) {
      // A test that did not script an insert almost certainly did not expect
      // one. Failing loudly is better than quietly reporting success.
      throw new Error("FakeReplyClient received an unscripted insertReply call");
    }
    return this.script.insert(input);
  }

  async listReplies(parentCommentId: string): Promise<ListRepliesResult> {
    this.listCalls.push(parentCommentId);
    if (this.script.listReplies === undefined) {
      return { kind: "ok", replies: [], pageCount: 1 };
    }
    return this.script.listReplies(parentCommentId);
  }
}
