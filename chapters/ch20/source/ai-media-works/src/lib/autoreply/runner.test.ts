import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { FakeGeminiClient } from "../gemini/__fixtures__/fake-client";
import {
  FakeReplyClient,
  FakeYoutubeClient,
  fakeComment,
  fakeVideo,
} from "../youtube/__fixtures__/fake-clients";
import { CommentsListResult } from "../youtube/types";
import { FakeAutoReplyStore } from "./__fixtures__/fake-store";
import {
  AutoReplyDeps,
  bootstrapAutoReply,
  prepareAutoReplyTarget,
  prepareApprovedReply,
  runScheduledAutoReply,
  sendApprovedReply,
  stopAutoReply,
} from "./runner";
import { APPROVAL_TTL_SECONDS } from "./policy";

/**
 * The whole chapter 20 job with every outside system faked: no YouTube, no
 * Gemini, no database. Each test here corresponds to a promise the chapter
 * makes in plain words, and the fakes record their calls so the test can also
 * assert what did NOT happen — which for a feature that posts in public is the
 * more important half.
 */

const CHANNEL_ID = "UC_MINE";
const VIDEO_ID = "VIDEO_1";
const ACTIVATED_AT = "2026-09-14T00:00:00.000Z";
const NOW = new Date("2026-09-14T09:00:00.000Z");
const SEOUL_TODAY = "2026-09-14";

/** A Gemini script that approves everything, so the run reaches the send. */
function approvingGemini(): FakeGeminiClient {
  return new FakeGeminiClient({
    classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
    draft: () => ({ draft: "봐 주셔서 감사합니다." }),
    contextCheck: () => ({ passed: true, reason: "문맥에 맞습니다." }),
  });
}

interface Harness {
  deps: AutoReplyDeps;
  store: FakeAutoReplyStore;
  youtube: FakeYoutubeClient;
  replies: FakeReplyClient;
  gemini: FakeGeminiClient;
}

function harness(options: {
  store?: FakeAutoReplyStore;
  comments?: CommentsListResult;
  commentPages?: Record<string, CommentsListResult>;
  replies?: FakeReplyClient;
  gemini?: FakeGeminiClient;
  now?: Date;
  video?: ReturnType<typeof fakeVideo>;
  myChannelId?: string;
}): Harness {
  const store =
    options.store ??
    new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
  const youtube = new FakeYoutubeClient({
    myChannelId: options.myChannelId ?? CHANNEL_ID,
    video: options.video ?? fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID }),
    comments: options.comments,
    commentPages: options.commentPages,
  });
  const replies = options.replies ?? new FakeReplyClient();
  const gemini = options.gemini ?? approvingGemini();
  const now = options.now ?? NOW;
  return {
    store,
    youtube,
    replies,
    gemini,
    deps: { store, youtube, replies, gemini, now: () => now },
  };
}

function newComment(id: string, publishedAt = "2026-09-14T08:00:00.000Z") {
  return fakeComment({ threadId: `THREAD_${id}`, topLevelCommentId: id, publishedAt });
}

// ---------------------------------------------------------------------------

describe("turning it on", () => {
  it("stores the start time and sends nothing, even with a full backlog", async () => {
    const store = new FakeAutoReplyStore();
    const { deps, replies } = harness({
      store,
      comments: {
        kind: "ok",
        comments: [
          newComment("C_OLD_1", "2026-09-13T00:00:00.000Z"),
          newComment("C_OLD_2", "2026-09-12T00:00:00.000Z"),
        ],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    const report = await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);

    expect(report.outcome).toBe("activated");
    expect(report.sentCount).toBe(0);
    expect(report.settings).toMatchObject({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: NOW.toISOString(),
    });
    // The proof it sent nothing: the write client was never called at all.
    expect(replies.insertCalls).toEqual([]);
  });

  it("sends zero on the very first scheduled run after activation", async () => {
    const store = new FakeAutoReplyStore();
    const backlog = {
      kind: "ok" as const,
      comments: [newComment("C_OLD", "2026-09-13T00:00:00.000Z")],
      nextPageToken: null,
      skippedCount: 0,
    };
    const { deps, replies } = harness({ store, comments: backlog });

    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);
    const run = await runScheduledAutoReply(deps);

    expect(run.outcome).toBe("no_target");
    expect(run.sentCount).toBe(0);
    expect(replies.insertCalls).toEqual([]);
    // The backlog comment was seen and explicitly passed over, not missed.
    expect(run.skipped).toEqual([
      { topLevelCommentId: "C_OLD", reason: "published_before_activation" },
    ]);
  });

  it("keeps the first start time when it is turned on again, so nothing is skipped", async () => {
    const store = new FakeAutoReplyStore();
    let clock = NOW;
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const deps: AutoReplyDeps = {
      store,
      replies,
      youtube: new FakeYoutubeClient({
        myChannelId: CHANNEL_ID,
        video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID }),
        comments: {
          kind: "ok",
          // Posted while the schedule was off.
          comments: [newComment("C_MID", "2026-09-14T10:00:00.000Z")],
          nextPageToken: null,
          skippedCount: 0,
        },
      }),
      gemini: approvingGemini(),
      now: () => clock,
    };

    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    const first = await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);
    await stopAutoReply(deps);
    clock = new Date("2026-09-14T12:00:00.000Z");
    const again = await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);
    const run = await runScheduledAutoReply(deps);

    expect(first.settings?.activatedAt).toBe(NOW.toISOString());
    // Turning it on again resumes: the baseline is NOT re-stamped, so the
    // comment that arrived during the pause is still in scope.
    expect(again.settings).toMatchObject({
      enabled: true,
      activatedAt: NOW.toISOString(),
      stoppedAt: null,
      stopReason: null,
    });
    expect(run.outcome).toBe("sent");
    expect(replies.insertCalls).toEqual([
      { parentCommentId: "C_MID", text: "봐 주셔서 감사합니다." },
    ]);
  });

  it("refuses to activate on a video that is not the connected channel's", async () => {
    const store = new FakeAutoReplyStore();
    const { deps } = harness({
      store,
      video: fakeVideo({ videoId: VIDEO_ID, channelId: "UC_SOMEONE_ELSE" }),
    });

    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    const report = await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);

    expect(report.outcome).toBe("channel_mismatch");
    expect((await store.readSettings()).enabled).toBe(false);
  });

  it("refuses to activate on a private video", async () => {
    const store = new FakeAutoReplyStore();
    const { deps } = harness({
      store,
      video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID, privacyStatus: "private" }),
    });

    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    const report = await bootstrapAutoReply({ videoId: VIDEO_ID }, deps);

    expect(report.outcome).toBe("privacy_blocked");
    expect((await store.readSettings()).enabled).toBe(false);
  });
});

describe("a normal scheduled run", () => {
  it("sends exactly one reply and records the reply id", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("sent");
    expect(report.sentCount).toBe(1);
    expect(report.replyCommentId).toBe("REPLY_1");
    expect(replies.insertCalls).toEqual([
      { parentCommentId: "C_NEW", text: "봐 주셔서 감사합니다." },
    ]);
    expect(store.peek("C_NEW")).toMatchObject({ status: "SENT", replyCommentId: "REPLY_1" });
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
  });

  it("examines all eligible targets while withholding unverifiable repeated replies", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const { deps } = harness({
      replies,
      comments: {
        kind: "ok",
        comments: [
          newComment("C_3", "2026-09-14T08:00:00.000Z"),
          newComment("C_2", "2026-09-14T06:00:00.000Z"),
          newComment("C_1", "2026-09-14T04:00:00.000Z"),
        ],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.sentCount).toBe(1);
    expect(replies.insertCalls).toHaveLength(1);
    // Oldest eligible first.
    expect(report.targetCommentId).toBe("C_3");
    expect(report.deferredCount).toBe(0);
  });

  it("never answers a question, a factual complaint, or an ad", async () => {
    const gemini = new FakeGeminiClient({
      classify: () => ({ category: "QUESTION", mixedSignals: false }),
    });
    const replies = new FakeReplyClient();
    const { deps } = harness({
      gemini,
      replies,
      comments: { kind: "ok", comments: [newComment("C_Q")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("no_target");
    expect(replies.insertCalls).toEqual([]);
    expect(report.skipped).toEqual([{ topLevelCommentId: "C_Q", reason: "not_auto_reply_tier" }]);
  });

  it("never answers a comment whose draft failed either chapter 19 check", async () => {
    const gemini = new FakeGeminiClient({
      classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: () => ({ draft: "봐 주셔서 감사합니다." }),
      contextCheck: () => ({ passed: false, reason: "문맥과 맞지 않습니다." }),
    });
    const replies = new FakeReplyClient();
    const { deps } = harness({
      gemini,
      replies,
      comments: { kind: "ok", comments: [newComment("C_BAD")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("no_target");
    expect(replies.insertCalls).toEqual([]);
  });

  it("does not send when the approved video no longer passes its re-check", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({
      replies,
      video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID, privacyStatus: "private" }),
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("video_check_failed");
    expect(report.sentCount).toBe(0);
    expect(replies.insertCalls).toEqual([]);
  });

  it("does not send when the comment list could not be read", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({ replies, comments: { kind: "quota_exceeded" } });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("comments_unavailable");
    expect(replies.insertCalls).toEqual([]);
  });
});

describe("never twice on the same comment", () => {
  it("adds zero sends when the same comment comes round again", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const comments = { kind: "ok" as const, comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 };
    const { deps, store } = harness({ replies, comments });

    const first = await runScheduledAutoReply(deps);
    const second = await runScheduledAutoReply(deps);
    const third = await runScheduledAutoReply(deps);

    expect(first.sentCount).toBe(1);
    expect(second.sentCount).toBe(0);
    expect(third.sentCount).toBe(0);
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
  });

  it("does not spend a Gemini call on a comment that already has a record", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const gemini = approvingGemini();
    const comments = { kind: "ok" as const, comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 };
    const { deps } = harness({ replies, gemini, comments });

    await runScheduledAutoReply(deps);
    const callsAfterFirst = gemini.classifyCalls.length;
    await runScheduledAutoReply(deps);

    expect(gemini.classifyCalls.length).toBe(callsAfterFirst);
  });

  it("refuses again even after the claim lock has expired", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    // A send that was confirmed hours ago; its lock is long past.
    store.seedSend({
      topLevelCommentId: "C_NEW",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_OLD",
      sendDay: SEOUL_TODAY,
      claimedAt: "2026-09-14T01:00:00.000Z",
      resolvedAt: "2026-09-14T01:00:01.000Z",
      lockExpiresAt: "2026-09-14T01:10:00.000Z",
    });
    const replies = new FakeReplyClient();
    const { deps } = harness({
      store,
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.sentCount).toBe(0);
    // Expiry earns a reply-list check at most; it is never permission to send.
    expect(replies.insertCalls).toEqual([]);
  });
});

describe("the five-per-Asia/Seoul-day limit", () => {
  it("continues sending after five earlier attempts", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedReserved(SEOUL_TODAY, 5);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "AFTER_FIVE" }) });
    const { deps } = harness({
      store,
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("sent");
    expect(report.sentCount).toBe(1);
    expect(replies.insertCalls).toHaveLength(1);
  });

  it("counts the day in Asia/Seoul, so a fresh Seoul morning has its own slots", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedReserved("2026-09-14", 5);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    // 15:10 UTC is 00:10 on 2026-09-15 in Seoul — a new day, new slots.
    const { deps } = harness({
      store,
      replies,
      now: new Date("2026-09-14T15:10:00.000Z"),
      comments: {
        kind: "ok",
        comments: [newComment("C_NEW", "2026-09-14T15:05:00.000Z")],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("sent");
    expect(store.reservedOn("2026-09-15")).toBe(1);
    expect(store.reservedOn("2026-09-14")).toBe(5);
  });
});

describe("a send whose result nobody saw", () => {
  it("stops automation, keeps the slot spent, and does not try again", async () => {
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "result_unknown", reason: "connection_interrupted" }),
    });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("halted_result_unknown");
    expect(report.sentCount).toBe(0);
    expect(report.automationEnabled).toBe(false);
    // No refund: the reply may exist, so its slot stays spent.
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    expect(store.peek("C_NEW")).toMatchObject({
      status: "RESULT_UNKNOWN",
      reason: "connection_interrupted",
      replyCommentId: null,
    });
    // Automation is off, so the next run does not even look.
    const next = await runScheduledAutoReply(deps);
    expect(next.outcome).toBe("disabled");
    expect(replies.insertCalls).toHaveLength(1);
  });

  it("never calls releaseSend on the unobserved send", async () => {
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "result_unknown", reason: "server_error" }),
    });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    await runScheduledAutoReply(deps);

    expect(store.calls).toContain("haltOnResultUnknown");
    expect(store.calls).not.toContain("releaseSend");
  });

  it("gives the slot back only when YouTube refused before creating anything", async () => {
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "rejected", reason: "parent_not_found" }),
    });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("send_rejected");
    expect(report.automationEnabled).toBe(true);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(0);
    expect(store.peek("C_NEW")).toMatchObject({ status: "FAILED", reason: "parent_not_found" });
  });
});

describe("settling an unobserved send against the reply list", () => {
  function pendingStore(): FakeAutoReplyStore {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedSend({
      topLevelCommentId: "C_PENDING",
      videoId: VIDEO_ID,
      status: "CLAIMED",
      reason: "GENERAL_REACTION",
      replyCommentId: null,
      sendDay: SEOUL_TODAY,
      claimedAt: "2026-09-14T02:00:00.000Z",
      resolvedAt: null,
      // Expired well before NOW, so this run will reconcile it.
      lockExpiresAt: "2026-09-14T02:10:00.000Z",
    });
    return store;
  }

  it("keeps human review when authorship cannot prove which send created a reply", async () => {
    const store = pendingStore();
    const replies = new FakeReplyClient({
      listReplies: () => ({
        kind: "ok",
        replies: [
          { replyCommentId: "R_OTHER", authorChannelId: "UC_VIEWER" },
          { replyCommentId: "R_MINE", authorChannelId: CHANNEL_ID },
        ],
        pageCount: 2,
      }),
    });
    const { deps } = harness({ store, replies, comments: { kind: "empty" } });

    const report = await runScheduledAutoReply(deps);

    expect(report.reconciled).toEqual([
      { topLevelCommentId: "C_PENDING", outcome: "needs_review", pageCount: 2 },
    ]);
    expect(store.peek("C_PENDING")).toMatchObject({ status: "RESULT_UNKNOWN", replyCommentId: null });
    expect(replies.insertCalls).toEqual([]);
  });

  it("records no-reply-found after a complete walk, and still does not re-send", async () => {
    const store = pendingStore();
    const replies = new FakeReplyClient({
      listReplies: () => ({
        kind: "ok",
        replies: [{ replyCommentId: "R_OTHER", authorChannelId: "UC_VIEWER" }],
        pageCount: 3,
      }),
    });
    const { deps } = harness({ store, replies, comments: { kind: "empty" } });

    const report = await runScheduledAutoReply(deps);

    expect(report.reconciled[0]?.outcome).toBe("no_reply_found");
    expect(store.peek("C_PENDING")?.status).toBe("UNCONFIRMED_NO_REPLY");
    // No refund even here, and no automatic retry — a person decides.
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    expect(replies.insertCalls).toEqual([]);
  });

  it("concludes nothing from an incomplete walk", async () => {
    const store = pendingStore();
    const replies = new FakeReplyClient({
      listReplies: () => ({ kind: "page_limit_reached", replies: [], pageCount: 100 }),
    });
    const { deps } = harness({ store, replies, comments: { kind: "empty" } });

    const report = await runScheduledAutoReply(deps);

    expect(report.reconciled[0]?.outcome).toBe("inconclusive");
    // Still CLAIMED: an unfinished walk must never be read as "no reply".
    expect(store.peek("C_PENDING")?.status).toBe("CLAIMED");
  });

  it("leaves a fresh claim alone, because another run may be sending it right now", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedSend({
      topLevelCommentId: "C_INFLIGHT",
      videoId: VIDEO_ID,
      status: "CLAIMED",
      reason: "GENERAL_REACTION",
      replyCommentId: null,
      sendDay: SEOUL_TODAY,
      claimedAt: NOW.toISOString(),
      resolvedAt: null,
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
    });
    const replies = new FakeReplyClient();
    const { deps } = harness({ store, replies, comments: { kind: "empty" } });

    const report = await runScheduledAutoReply(deps);

    expect(report.reconciled).toEqual([]);
    expect(replies.listCalls).toEqual([]);
  });
});

describe("after stop", () => {
  it("sends nothing on any later scheduled run", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "R" }) });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const settings = await stopAutoReply(deps);
    const first = await runScheduledAutoReply(deps);
    const second = await runScheduledAutoReply(deps);

    expect(settings).toMatchObject({ enabled: false, stopReason: "manual" });
    expect(first.outcome).toBe("disabled");
    expect(second.outcome).toBe("disabled");
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });

  it("still sends a reply a person approved, because the switch was never the approval", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_M" }) });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    await stopAutoReply(deps);
    const report = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: (await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps)).approvalToken ?? undefined },
      deps,
    );

    // Turning the timer off says "stop deciding for me", not "never let me
    // answer this one". The timer stays off either way.
    expect(report.outcome).toBe("sent");
    expect(report.sentCount).toBe(1);
    expect((await store.readSettings()).enabled).toBe(false);
    expect(await store.readLastRun()).toMatchObject({ outcome: "sent", automationEnabled: false });
    expect((await runScheduledAutoReply(deps)).outcome).toBe("disabled");
  });

  it("refuses a manual send while a send's result is still unknown", async () => {
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "result_unknown", reason: "connection_interrupted" }),
    });
    const { deps } = harness({
      replies,
      comments: {
        kind: "ok",
        comments: [
          newComment("C_OLDER", "2026-09-14T07:00:00.000Z"),
          newComment("C_NEWER", "2026-09-14T08:00:00.000Z"),
        ],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const halted = await runScheduledAutoReply(deps);
    const manual = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEWER", approvalToken: (await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEWER" }, deps)).approvalToken ?? undefined },
      deps,
    );

    expect(halted.outcome).toBe("halted_result_unknown");
    // A halt is the one thing a person's approval does not override: nothing at
    // all may be sent until somebody has looked at what happened.
    expect(manual.outcome).toBe("halted");
    expect(manual.sentCount).toBe(0);
    expect(replies.insertCalls).toHaveLength(1);
  });
});

describe("the manual approved single send", () => {
  it("sends one reply the server drafted itself", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_M" }) });
    const { deps } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: (await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps)).approvalToken ?? undefined },
      deps,
    );

    expect(report.outcome).toBe("sent");
    expect(report.sentCount).toBe(1);
    // The text came from the server's own draft, not from the request.
    expect(replies.insertCalls).toEqual([
      { parentCommentId: "C_NEW", text: "봐 주셔서 감사합니다." },
    ]);
  });

  it("refuses a video that is not the approved one", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({ replies, comments: { kind: "empty" } });

    const report = await sendApprovedReply(
      { videoId: "VIDEO_OTHER", topLevelCommentId: "C_NEW" },
      deps,
    );

    expect(report.outcome).toBe("video_not_approved");
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses a comment that is not on the approved video's recent list", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NOT_THERE" },
      deps,
    );

    expect(report.outcome).toBe("comment_not_found");
    expect(replies.insertCalls).toEqual([]);
  });

  it("does not let a person's approval bypass the eligibility gate", async () => {
    const gemini = new FakeGeminiClient({
      classify: () => ({ category: "FACT_OR_COMPLAINT", mixedSignals: false }),
    });
    const replies = new FakeReplyClient();
    const { deps } = harness({
      gemini,
      replies,
      comments: { kind: "ok", comments: [newComment("C_FACT")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_FACT" },
      deps,
    );

    expect(report.outcome).toBe("not_eligible");
    expect(report.skipped).toEqual([
      { topLevelCommentId: "C_FACT", reason: "not_auto_reply_tier" },
    ]);
    expect(replies.insertCalls).toEqual([]);
  });

  it("continues sending after five earlier attempts", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedReserved(SEOUL_TODAY, 5);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "AFTER_FIVE" }) });
    const { deps } = harness({
      store,
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const report = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: (await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps)).approvalToken ?? undefined },
      deps,
    );

    expect(report.outcome).toBe("sent");
    expect(replies.insertCalls).toHaveLength(1);
  });
});

describe("reading past the newest twenty", () => {
  function pagedStore(cursorPageToken: string | null): FakeAutoReplyStore {
    return new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
      cursorPageToken,
    });
  }

  it("continues from the saved page and remembers the next one", async () => {
    const store = pagedStore("PAGE_2");
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const { deps, youtube } = harness({
      store,
      replies,
      commentPages: {
        "": { kind: "ok", comments: [newComment("C_NEWEST")], nextPageToken: "PAGE_2", skippedCount: 0 },
        PAGE_2: { kind: "ok", comments: [newComment("C_ON_PAGE_2")], nextPageToken: "PAGE_3", skippedCount: 0 },
      },
    });

    const report = await runScheduledAutoReply(deps);

    // It asked for the saved page, not the newest one.
    expect(youtube.listPageTokens).toEqual(["PAGE_2"]);
    expect(report.targetCommentId).toBe("C_ON_PAGE_2");
    expect(report.cursorHasMore).toBe(true);
    // And the walk moves on, so the run after this one reads page 3.
    expect((await store.readSettings()).cursorPageToken).toBe("PAGE_3");
  });

  it("advances after processing all candidates on the page", async () => {
    const store = pagedStore(null);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const { deps } = harness({
      store,
      replies,
      commentPages: {
        "": {
          kind: "ok",
          comments: [
            newComment("C_1", "2026-09-14T04:00:00.000Z"),
            newComment("C_2", "2026-09-14T05:00:00.000Z"),
            newComment("C_3", "2026-09-14T06:00:00.000Z"),
          ],
          nextPageToken: "PAGE_2",
          skippedCount: 0,
        },
      },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.deferredCount).toBe(0);
    // One reply per run means two comments on this page are still unanswered.
    // Moving the cursor now would leave them for a whole trip round the video.
    expect((await store.readSettings()).cursorPageToken).toBe("PAGE_2");
  });

  it("starts the walk over when the saved page token is no longer accepted", async () => {
    const store = pagedStore("STALE_TOKEN");
    const replies = new FakeReplyClient();
    const { deps } = harness({
      store,
      replies,
      commentPages: {
        "": { kind: "ok", comments: [newComment("C_NEWEST")], nextPageToken: null, skippedCount: 0 },
      },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("comments_unavailable");
    // Cleared rather than kept, so a token the API has stopped accepting cannot
    // wedge the walk on one page forever.
    expect((await store.readSettings()).cursorPageToken).toBeNull();
    expect(replies.insertCalls).toEqual([]);
  });

  it("goes back to the newest page once a page comes back empty", async () => {
    const store = pagedStore("PAGE_9");
    const { deps } = harness({
      store,
      commentPages: { PAGE_9: { kind: "empty" } },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("no_target");
    expect((await store.readSettings()).cursorPageToken).toBeNull();
  });
});

describe("what a run leaves behind", () => {
  it("records a scheduled run with its counts and nothing a viewer wrote", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    await runScheduledAutoReply(deps);
    const last = await store.readLastRun();

    expect(last).toMatchObject({
      trigger: "scheduled",
      outcome: "sent",
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      consideredCount: 1,
      deferredCount: 0,
      humanReviewCount: 0,
      failureCount: 0,
      sentCount: 1,
      automationEnabled: true,
      cursorHasMore: false,
    });
    // The record is ids, labels and counts. The comment and the reply are not
    // in it, so a leaked backup cannot leak what somebody wrote.
    const serialized = JSON.stringify(last);
    expect(serialized).not.toContain("잘 봤습니다");
    expect(serialized).not.toContain("봐 주셔서 감사합니다");
  });

  it("records a run that decided to do nothing, and why", async () => {
    const store = new FakeAutoReplyStore({
      enabled: false,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    const { deps } = harness({
      store,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    await runScheduledAutoReply(deps);

    // A run that sent nothing is still a run: without this row, "the timer
    // never fired" and "the timer fired and refused" look identical.
    expect(store.runCount()).toBe(1);
    expect(await store.readLastRun()).toMatchObject({
      trigger: "scheduled",
      outcome: "disabled",
      sentCount: 0,
      automationEnabled: false,
      completedAt: NOW.toISOString(),
    });
  });

  it("counts the comments it left for a person and the reviews that failed", async () => {
    const gemini = new FakeGeminiClient({
      classify: (text) => {
        if (text.includes("질문")) throw new Error("upstream is down");
        return { category: "QUESTION", mixedSignals: false };
      },
    });
    const { deps, store } = harness({
      gemini,
      comments: {
        kind: "ok",
        comments: [
          newComment("C_Q", "2026-09-14T07:00:00.000Z"),
          fakeComment({
            threadId: "THREAD_F",
            topLevelCommentId: "C_FAILED",
            text: "질문 있습니다",
            publishedAt: "2026-09-14T08:00:00.000Z",
          }),
        ],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("no_target");
    expect(await store.readLastRun()).toMatchObject({
      consideredCount: 2,
      // Both ended up with a person; only one of them is Gemini's fault.
      humanReviewCount: 2,
      failureCount: 1,
      sentCount: 0,
    });
  });

  it("records a manual send as a manual run", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_M" }) });
    const { deps, store } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    await sendApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: (await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps)).approvalToken ?? undefined }, deps);

    expect(await store.readLastRun()).toMatchObject({
      trigger: "manual",
      outcome: "sent",
      consideredCount: 1,
      sentCount: 1,
      completedAt: NOW.toISOString(),
    });
  });
});

describe("keeping only thirty days", () => {
  it("purges old records even on a run that does nothing else", async () => {
    const store = new FakeAutoReplyStore({
      // Off, so this run returns at the very first check.
      enabled: false,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedSend({
      topLevelCommentId: "C_ANCIENT",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_OLD",
      sendDay: "2026-08-01",
      claimedAt: "2026-08-01T00:00:00.000Z",
      resolvedAt: "2026-08-01T00:00:01.000Z",
      lockExpiresAt: "2026-08-01T00:10:00.000Z",
    });
    const { deps } = harness({ store });

    const report = await runScheduledAutoReply(deps);

    expect(report.outcome).toBe("disabled");
    // Retention is not a reward for a run that got all the way to a send.
    expect(store.calls).toContain("purgeExpired");
    expect(store.peek("C_ANCIENT")).toBeUndefined();
  });

  it("keeps a record that is still inside the window", async () => {
    const store = new FakeAutoReplyStore({
      enabled: false,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedSend({
      topLevelCommentId: "C_RECENT",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_R",
      sendDay: "2026-09-01",
      claimedAt: "2026-09-01T00:00:00.000Z",
      resolvedAt: "2026-09-01T00:00:01.000Z",
      lockExpiresAt: "2026-09-01T00:10:00.000Z",
    });
    const { deps } = harness({ store });

    await runScheduledAutoReply(deps);

    expect(store.peek("C_RECENT")).toMatchObject({ status: "SENT" });
  });
});

describe("approving the exact sentence that was shown", () => {
  it("shows one draft, signs it, and sends that sentence unchanged", async () => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_A" }) });
    const gemini = approvingGemini();
    const { deps } = harness({
      replies,
      gemini,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW" },
      deps,
    );
    expect(preview.outcome).toBe("ready");
    expect(preview.draft).toBe("봐 주셔서 감사합니다.");
    expect(preview.approvalToken).not.toBeNull();
    // Showing a draft sends nothing.
    expect(replies.insertCalls).toEqual([]);

    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_NEW",
        approvalToken: preview.approvalToken ?? "",
      },
      deps,
    );

    expect(report.outcome).toBe("sent");
    // Byte for byte the sentence from the preview, and no second draft was
    // generated: a fresh one would be a different sentence, and then nothing
    // would connect what a person read to what went out.
    expect(replies.insertCalls).toEqual([
      { parentCommentId: "C_NEW", text: "봐 주셔서 감사합니다." },
    ]);
    expect(gemini.draftCalls).toHaveLength(1);
    // The approved sentence was checked again against the comment as it is now.
    expect(gemini.contextCheckCalls).toHaveLength(2);
  });

  it("refuses a token that was tampered with", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({
      replies,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW" },
      deps,
    );
    const [version, payload, signature] = (preview.approvalToken ?? "").split(".");
    const forged = `${version}.${payload}X.${signature}`;

    const report = await sendApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: forged },
      deps,
    );

    expect(report.outcome).toBe("approval_invalid");
    expect(report.approvalIssue).toBe("bad_signature");
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses a token issued for a different comment", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({
      replies,
      comments: {
        kind: "ok",
        comments: [newComment("C_ONE", "2026-09-14T07:00:00.000Z"), newComment("C_TWO")],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_ONE" },
      deps,
    );
    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_TWO",
        approvalToken: preview.approvalToken ?? "",
      },
      deps,
    );

    expect(report.outcome).toBe("approval_invalid");
    expect(report.approvalIssue).toBe("comment_mismatch");
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses once the comment has been edited since it was shown", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    const shown = harness({
      store,
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });
    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW" },
      shown.deps,
    );

    // The same comment, rewritten by its author after the draft was shown.
    const edited = harness({
      store,
      comments: {
        kind: "ok",
        comments: [
          fakeComment({
            threadId: "THREAD_C_NEW",
            topLevelCommentId: "C_NEW",
            text: "생각해보니 별로였습니다.",
            publishedAt: "2026-09-14T08:00:00.000Z",
          }),
        ],
        nextPageToken: null,
        skippedCount: 0,
      },
    });
    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_NEW",
        approvalToken: preview.approvalToken ?? "",
      },
      edited.deps,
    );

    expect(report.outcome).toBe("approval_invalid");
    expect(report.approvalIssue).toBe("comment_changed");
    expect(edited.replies.insertCalls).toEqual([]);
  });

  it("refuses an approval that sat around too long", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    const comments = {
      kind: "ok" as const,
      comments: [newComment("C_NEW")],
      nextPageToken: null,
      skippedCount: 0,
    };
    const shown = harness({ store, comments });
    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW" },
      shown.deps,
    );

    const later = harness({
      store,
      comments,
      now: new Date(NOW.getTime() + (APPROVAL_TTL_SECONDS + 1) * 1000),
    });
    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_NEW",
        approvalToken: preview.approvalToken ?? "",
      },
      later.deps,
    );

    expect(report.outcome).toBe("approval_invalid");
    expect(report.approvalIssue).toBe("expired");
    expect(later.replies.insertCalls).toEqual([]);
  });

  it("refuses when the approved sentence no longer passes its checks", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    const comments = {
      kind: "ok" as const,
      comments: [newComment("C_NEW")],
      nextPageToken: null,
      skippedCount: 0,
    };
    const shown = harness({ store, comments });
    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_NEW" },
      shown.deps,
    );

    const refusing = harness({
      store,
      comments,
      gemini: new FakeGeminiClient({
        classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
        draft: () => ({ draft: "봐 주셔서 감사합니다." }),
        contextCheck: () => ({ passed: false, reason: "문맥과 맞지 않습니다." }),
      }),
    });
    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_NEW",
        approvalToken: preview.approvalToken ?? "",
      },
      refusing.deps,
    );

    // The token proves what was shown, not that it is still safe to send.
    expect(report.outcome).toBe("approval_invalid");
    expect(report.approvalIssue).toBe("reply_not_verified");
    expect(refusing.replies.insertCalls).toEqual([]);
  });

  it("does not preview a comment that already has a record", async () => {
    const store = new FakeAutoReplyStore({
      enabled: true,
      channelId: CHANNEL_ID,
      videoId: VIDEO_ID,
      activatedAt: ACTIVATED_AT,
    });
    store.seedSend({
      topLevelCommentId: "C_DONE",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_OLD",
      sendDay: SEOUL_TODAY,
      claimedAt: NOW.toISOString(),
      resolvedAt: NOW.toISOString(),
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
    });
    const gemini = approvingGemini();
    const { deps } = harness({
      store,
      gemini,
      comments: { kind: "ok", comments: [newComment("C_DONE")], nextPageToken: null, skippedCount: 0 },
    });

    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_DONE" },
      deps,
    );

    expect(preview.outcome).toBe("already_recorded");
    expect(preview.draft).toBeNull();
    expect(preview.approvalToken).toBeNull();
    // No draft to show means no reason to have asked Gemini for one.
    expect(gemini.draftCalls).toEqual([]);
  });
});

describe("preparing the target a person picked", () => {
  /** A store in the state a brand-new server is in: nothing chosen at all. */
  function emptyStore(): FakeAutoReplyStore {
    return new FakeAutoReplyStore({});
  }

  it("stores the target explicitly before preparing a draft", async () => {
    const store = emptyStore();
    const { deps, replies } = harness({
      store,
      comments: { kind: "ok", comments: [newComment("C_OLD")], nextPageToken: null, skippedCount: 0 },
    });

    const target = await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    expect(target.outcome).toBe("activated");
    const preview = await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_OLD" }, deps);

    expect(preview.targetPrepared).toBe(false);
    const settings = await store.readSettings();
    expect(settings.channelId).toBe(CHANNEL_ID);
    expect(settings.videoId).toBe(VIDEO_ID);
    expect(settings.activatedAt).toBe(NOW.toISOString());
    // The switch stays where a person left it. This is the whole point: a target
    // can now exist without the timer ever having run.
    expect(settings.enabled).toBe(false);
    expect(store.calls).not.toContain("enableSchedule");
    // And it is still only a preview: no slot, no row, no reply.
    expect(store.calls).not.toContain("beginSend");
    expect(store.calls).not.toContain("claimSend");
    expect(replies.insertCalls).toEqual([]);
  });

  it("answers nothing that was already on the video, because the baseline is a floor", async () => {
    const store = emptyStore();
    const { deps } = harness({
      store,
      comments: {
        kind: "ok",
        // Both were published before the baseline this call stamps at 09:00.
        comments: [newComment("C_OLD"), newComment("C_OLDER", "2026-09-14T07:00:00.000Z")],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    const target = await prepareAutoReplyTarget({ videoId: VIDEO_ID }, deps);
    expect(target.outcome).toBe("activated");
    const preview = await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_OLD" }, deps);

    // Storing a target can no more answer a backlog than turning the timer on
    // can, and the reason is reported rather than hidden behind "no target".
    expect(preview.outcome).toBe("not_eligible");
    expect(preview.skipped).toEqual([
      { topLevelCommentId: "C_OLD", reason: "published_before_activation" },
    ]);
    expect(preview.targetPrepared).toBe(false);
  });

  it("writes nothing on a later preview of the same video, and keeps the baseline", async () => {
    const store = emptyStore();
    const comments = {
      kind: "ok" as const,
      comments: [newComment("C_OLD")],
      nextPageToken: null,
      skippedCount: 0,
    };
    await prepareAutoReplyTarget({ videoId: VIDEO_ID }, harness({ store, comments }).deps);
    await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_OLD" },
      harness({ store, comments }).deps,
    );
    const baseline = (await store.readSettings()).activatedAt;
    expect(baseline).toBe(NOW.toISOString());
    const callsAfterFirst = store.calls.length;

    const again = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_OLD" },
      harness({ store, comments, now: new Date(NOW.getTime() + 60 * 60 * 1000) }).deps,
    );

    expect(again.targetPrepared).toBe(false);
    expect(store.calls.slice(callsAfterFirst)).not.toContain("prepareTarget");
    // A second preview must not move the floor forward: comments that became
    // eligible after the first one would silently drop out of scope.
    expect((await store.readSettings()).activatedAt).toBe(baseline);
  });

  it("refuses to re-point the target at another video", async () => {
    const { deps, store } = harness({
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });

    const preview = await prepareApprovedReply(
      { videoId: "SOME_OTHER_VIDEO", topLevelCommentId: "C_NEW" },
      deps,
    );

    // Re-pointing moves what the timer answers and voids every approval already
    // on somebody's screen, so it stays an explicit act.
    expect(preview.outcome).toBe("video_not_approved");
    expect(preview.targetPrepared).toBe(false);
    expect(store.calls).not.toContain("prepareTarget");
  });

  it("checks ownership and privacy before storing anything", async () => {
    const notMine = harness({
      store: emptyStore(),
      myChannelId: "UC_SOMEONE_ELSE",
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });
    const mismatch = await prepareAutoReplyTarget(
      { videoId: VIDEO_ID },
      notMine.deps,
    );
    expect(mismatch.outcome).toBe("channel_mismatch");
    expect(notMine.store.calls).not.toContain("prepareTarget");

    const hidden = harness({
      store: emptyStore(),
      video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID, privacyStatus: "private" }),
      comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 },
    });
    const blocked = await prepareAutoReplyTarget(
      { videoId: VIDEO_ID },
      hidden.deps,
    );
    // The same two checks /enable makes, in the same order — a target stored by
    // a preview is not a target held to a lower standard.
    expect(blocked.outcome).toBe("privacy_blocked");
    expect(hidden.store.calls).not.toContain("prepareTarget");
  });

  it("carries one reply from an empty store to sent without the schedule", async () => {
    const store = emptyStore();
    // Step 1: the person picks the video. Nothing on it is answerable yet.
    const first = await prepareAutoReplyTarget(
      { videoId: VIDEO_ID },
      harness({
        store,
        comments: { kind: "ok", comments: [newComment("C_OLD")], nextPageToken: null, skippedCount: 0 },
      }).deps,
    );
    expect(first.outcome).toBe("activated");
    expect(first.sentCount).toBe(0);

    // Step 2: a comment arrives after that baseline, and an hour passes.
    const later = new Date(NOW.getTime() + 60 * 60 * 1000);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_M" }) });
    const running = harness({
      store,
      replies,
      now: later,
      comments: {
        kind: "ok",
        comments: [newComment("C_AFTER", "2026-09-14T09:30:00.000Z")],
        nextPageToken: null,
        skippedCount: 0,
      },
    });

    // Step 3: the draft appears, and this time nothing is stored.
    const preview = await prepareApprovedReply(
      { videoId: VIDEO_ID, topLevelCommentId: "C_AFTER" },
      running.deps,
    );
    expect(preview.outcome).toBe("ready");
    expect(preview.targetPrepared).toBe(false);

    // Step 4: the person approves, and that exact sentence goes out.
    const report = await sendApprovedReply(
      {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_AFTER",
        approvalToken: preview.approvalToken ?? "",
      },
      running.deps,
    );

    expect(report.outcome).toBe("sent");
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_AFTER", text: preview.draft }]);
    // Four steps, one reply, and the timer was never switched on once.
    expect(report.automationEnabled).toBe(false);
    expect(store.calls).not.toContain("enableSchedule");
  });
});

describe("explicit approval and observable runs", () => {
  it("rejects a tokenless internal manual send without drafting or posting", async () => {
    const { deps, replies, gemini } = harness({ comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 } });
    const report = await sendApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps);
    expect(report.outcome).toBe("approval_invalid");
    expect(gemini.draftCalls).toHaveLength(0);
    expect(replies.insertCalls).toHaveLength(0);
  });

  it("reports an exception as run_failed rather than a completed zero-candidate run", async () => {
    const { deps, store } = harness({});
    const original = store.readSettings.bind(store);
    store.readSettings = async () => { throw new Error("storage unavailable"); };
    await expect(runScheduledAutoReply(deps)).rejects.toThrow();
    store.readSettings = original;
    expect((await store.listRecentRuns(20))[0]).toMatchObject({ outcome: "run_failed", failureCount: 1 });
  });
});


describe("confirmed sends survive a statistics failure", () => {
  it.each(["scheduled", "manual"] as const)("preserves %s sent count when countDay fails after a confirmed insert", async trigger => {
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "CONFIRMED_REPLY" }) });
    const { deps, store } = harness({ replies, comments: { kind: "ok", comments: [newComment("C_NEW")], nextPageToken: null, skippedCount: 0 } });
    const approval = await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW" }, deps);
    const countDay = store.countDay.bind(store);
    store.countDay = async day => {
      if (store.peek("C_NEW")?.status === "SENT") throw new Error("statistics unavailable");
      return countDay(day);
    };
    const call = trigger === "scheduled" ? runScheduledAutoReply(deps) : sendApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "C_NEW", approvalToken: approval.approvalToken ?? "" }, deps);
    await expect(call).rejects.toThrow("statistics unavailable");
    expect(store.peek("C_NEW")).toMatchObject({ status: "SENT", replyCommentId: "CONFIRMED_REPLY" });
    expect(await store.readLastRun()).toMatchObject({ trigger, outcome: "run_failed", consideredCount: 1, failureCount: 1, sentCount: 1, automationEnabled: true });
    expect(replies.insertCalls).toHaveLength(1);
  });
});


describe("the complete chapter 20 send contract", () => {
  it("excludes own and unknown authors before any scheduled AI call", async () => {
    const { deps, gemini, replies } = harness({ comments: { kind: "ok", comments: [
      { ...newComment("OWN"), authorChannelId: CHANNEL_ID },
      { ...newComment("UNKNOWN"), authorChannelId: null },
    ], nextPageToken: null, skippedCount: 0 } });
    const report = await runScheduledAutoReply(deps);
    expect(report.skipped).toHaveLength(2);
    expect(gemini.classifyCalls).toHaveLength(0);
    expect(replies.insertCalls).toHaveLength(0);
  });

  it("excludes the video owner's comment from manual preview and send", async () => {
    const replies = new FakeReplyClient();
    const { deps } = harness({ replies, comments: { kind: "ok", comments: [{ ...newComment("OWN"), authorChannelId: CHANNEL_ID }], nextPageToken: null, skippedCount: 0 } });
    const preview = await prepareApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "OWN" }, deps);
    expect(preview.outcome).toBe("not_eligible");
    expect(preview.skipped).toEqual([{ topLevelCommentId: "OWN", reason: "video_owner_comment" }]);
    expect(preview.approvalToken).toBeNull();
    const report = await sendApprovedReply({ videoId: VIDEO_ID, topLevelCommentId: "OWN", approvalToken: "invalid" }, deps);
    expect(report.outcome).toBe("not_eligible");
    expect(report.skipped).toEqual([{ topLevelCommentId: "OWN", reason: "video_owner_comment" }]);
    expect(replies.insertCalls).toHaveLength(0);
  });

  it.each([401, 429])("stops a scheduled batch after Gemini HTTP %s, including drafts already reviewed", async status => {
    const gemini = new FakeGeminiClient({ classify: () => { throw new ApiError({ message: "blocked", status }); } });
    const { deps, replies, store } = harness({ gemini, comments: { kind: "ok", comments: Array.from({ length: 20 }, (_, i) => newComment(`C_${i}`)), nextPageToken: null, skippedCount: 0 } });
    await expect(runScheduledAutoReply(deps)).rejects.toThrow("Review interrupted");
    expect(gemini.classifyCalls.length).toBeLessThanOrEqual(5);
    expect(gemini.draftCalls).toHaveLength(0);
    expect(replies.insertCalls).toHaveLength(0);
    expect((await store.readSettings()).enabled).toBe(false);
    expect(await store.readLastRun()).toMatchObject({ outcome: "run_failed", automationEnabled: false });
    expect((await runScheduledAutoReply(deps)).outcome).toBe("disabled");
  });

  it.each(["existing", "incomplete", "unknown-author"])("withholds a new send when its reply check is %s", async kind => {
    const replies = new FakeReplyClient({ listReplies: () => kind === "incomplete" ? { kind: "page_limit_reached", replies: [], pageCount: 100 } : { kind: "ok", replies: [{ replyCommentId: "OLD", authorChannelId: kind === "existing" ? CHANNEL_ID : null }], pageCount: 1 } });
    const { deps, store } = harness({ replies, comments: { kind: "ok", comments: [newComment("NEW")], nextPageToken: null, skippedCount: 0 } });
    const report = await runScheduledAutoReply(deps);
    expect(report.outcome).toBe("needs_review");
    expect(replies.insertCalls).toHaveLength(0);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(0);
    expect(store.peekLease()).toBeNull();
  });

  it("blocks the same sentence on a different parent after recreating the runner", async () => {
    const published = new Map<string, { replyCommentId: string; authorChannelId: string; text: string }>();
    const replies = new FakeReplyClient({
      insert: input => { const reply = { replyCommentId: `R_${input.parentCommentId}`, authorChannelId: CHANNEL_ID, text: input.text }; published.set(input.parentCommentId, reply); return { kind: "ok", replyCommentId: reply.replyCommentId }; },
      listReplies: id => ({ kind: "ok", replies: published.has(id) ? [published.get(id)!] : [], pageCount: 1 }),
    });
    const first = harness({ replies, comments: { kind: "ok", comments: [newComment("FIRST")], nextPageToken: null, skippedCount: 0 } });
    expect((await runScheduledAutoReply(first.deps)).sentCount).toBe(1);
    const second = harness({ store: first.store, replies, comments: { kind: "ok", comments: [newComment("SECOND")], nextPageToken: null, skippedCount: 0 } });
    expect((await runScheduledAutoReply(second.deps)).outcome).toBe("needs_review");
    expect(replies.insertCalls).toHaveLength(1);
    expect(first.store.reservedOn(SEOUL_TODAY)).toBe(1);
  });
});


describe("preflight failures and stopping", () => {
  it("rechecks stop after a slow reply read, before any quota claim", async () => {
    const { deps, store, replies } = harness({ comments: { kind: "ok", comments: [newComment("NEW")], nextPageToken: null, skippedCount: 0 } });
    replies.listReplies = async () => { await stopAutoReply(deps); return { kind: "ok", replies: [], pageCount: 1 }; };
    expect((await runScheduledAutoReply(deps)).outcome).toBe("disabled");
    expect(replies.insertCalls).toHaveLength(0);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(0);
    expect(store.peekLease()).toBeNull();
  });
  it("releases a lease after a read failure without inventing an unknown send", async () => {
    const { deps, store } = harness({ comments: { kind: "ok", comments: [newComment("NEW")], nextPageToken: null, skippedCount: 0 } });
    store.listRecentConfirmedSends = async () => { throw new Error("read unavailable"); };
    await expect(runScheduledAutoReply(deps)).rejects.toThrow("read unavailable");
    expect(store.peekLease()).toBeNull();
    expect((await store.readSettings()).stopReason).toBeNull();
    expect(await store.readLastRun()).toMatchObject({ outcome: "run_failed", sentCount: 0 });
  });
});


describe("Seoul midnight during preflight", () => {
  it("charges the day when the send starts after a preflight crosses midnight", async () => {
    let clock = new Date("2026-09-14T14:59:59.000Z");
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "MIDNIGHT" }), listReplies: () => { clock = new Date("2026-09-14T15:00:01.000Z"); return { kind: "ok", replies: [], pageCount: 1 }; } });
    const { deps, store } = harness({ replies, comments: { kind: "ok", comments: [newComment("NEW")], nextPageToken: null, skippedCount: 0 } });
    deps.now = () => clock;
    expect((await runScheduledAutoReply(deps)).sentCount).toBe(1);
    expect(store.reservedOn("2026-09-14")).toBe(0);
    expect(store.reservedOn("2026-09-15")).toBe(1);
    expect(replies.expectedSendDays).toEqual([undefined]);
  });
  it("continues sending across midnight without a daily admission rule", async () => {
    let clock = new Date("2026-09-14T14:59:59.000Z");
    const { deps, store, replies } = harness({ replies: new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "MIDNIGHT" }) }), comments: { kind: "ok", comments: [newComment("NEW")], nextPageToken: null, skippedCount: 0 } });
    deps.now = () => clock;
    const claim = store.claimSend.bind(store);
    store.claimSend = async input => { const result = await claim(input); clock = new Date("2026-09-14T15:00:01.000Z"); return result; };
    expect((await runScheduledAutoReply(deps)).outcome).toBe("sent");
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn("2026-09-14")).toBe(1);
    expect(store.reservedOn("2026-09-15")).toBe(0);
    expect(await store.readLastRun()).toMatchObject({ humanReviewCount: 0 });
  });
});


describe("scheduled batches without numeric send caps", () => {
  it.each(["normal", "unknown", "cleanup-error"])("records confirmed batch sends and stops correctly: %s", async mode => {
    const unknown = mode === "unknown";
    const published = new Map<string, { replyCommentId: string; authorChannelId: string; text: string }>();
    const replies = new FakeReplyClient({
      insert: input => {
        if (unknown && published.size === 2) return { kind: "result_unknown", reason: "connection_interrupted" };
        const reply = { replyCommentId: `R_${input.parentCommentId}`, authorChannelId: CHANNEL_ID, text: input.text };
        published.set(input.parentCommentId, reply);
        return { kind: "ok", replyCommentId: reply.replyCommentId };
      },
      listReplies: id => ({ kind: "ok", replies: published.has(id) ? [published.get(id)!] : [], pageCount: 1 }),
    });
    const gemini = new FakeGeminiClient({ classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }), draft: text => ({ draft: `${text} 감사합니다.` }), contextCheck: () => ({ passed: true, reason: "합성 검사" }) });
    const { deps, store } = harness({ replies, gemini, comments: { kind: "ok", comments: Array.from({ length: 7 }, (_, i) => ({ ...newComment(`B_${i}`), text: `${i + 1}번째 영상도 잘 봤습니다.` })), nextPageToken: null, skippedCount: 0 } });
    if (mode === "cleanup-error") {
      const end = store.endSend.bind(store);
      let ended = 0;
      store.endSend = async input => { if (++ended === 2) throw new Error("cleanup unavailable"); await end(input); };
      await expect(runScheduledAutoReply(deps)).rejects.toThrow("cleanup unavailable");
      expect(replies.insertCalls).toHaveLength(2);
      expect(await store.readLastRun()).toMatchObject({ outcome: "run_failed", sentCount: 2 });
      return;
    }
    const report = await runScheduledAutoReply(deps);
    expect(report.sentCount).toBe(unknown ? 2 : 7);
    expect(replies.insertCalls).toHaveLength(unknown ? 3 : 7);
    expect((await store.readLastRun())?.sentCount).toBe(unknown ? 2 : 7);
    const repeated = await runScheduledAutoReply(deps);
    expect(repeated.sentCount).toBe(0);
    expect(replies.insertCalls).toHaveLength(unknown ? 3 : 7);
  });
});
