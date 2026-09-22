import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeGeminiClient } from "@/lib/gemini/__fixtures__/fake-client";
import { FakeAutoReplyStore } from "@/lib/autoreply/__fixtures__/fake-store";
import { APPROVAL_TTL_SECONDS } from "@/lib/autoreply/policy";
import type { AutoReplyDeps } from "@/lib/autoreply/runner";
import {
  FakeReplyClient,
  FakeYoutubeClient,
  fakeComment,
  fakeVideo,
} from "@/lib/youtube/__fixtures__/fake-clients";
import type { CommentsListResult } from "@/lib/youtube/types";

/**
 * The six auto-reply endpoints, with every outside system faked.
 *
 * What this file is really guarding:
 *   - the scheduled run is unreachable without the scheduler secret, and the
 *     secret is only ever read from the Authorization header
 *   - a scheduled run answers HTTP 200 even when it halted, so a timer never
 *     retries a halt
 *   - approval takes two requests: prepare shows one signed sentence and sends
 *     nothing, and send posts that exact sentence and nothing else
 *   - the send request cannot supply the reply text, and cannot send at all
 *     without a valid, fresh, matching approval token
 *   - preparing stores the target and its baseline when nothing is stored yet,
 *     and that is the ONLY thing it writes: never the switch, never a slot
 *   - a person may still approve one reply while the SCHEDULE is off — including
 *     one that was never on — but not while a halt is on record
 *   - none of these routes ever returns a comment's text
 */

const CHANNEL_ID = "UC_MINE";
const VIDEO_ID = "VIDEO_1";
const ACTIVATED_AT = "2026-09-14T00:00:00.000Z";
const NOW = new Date("2026-09-14T09:00:00.000Z");
const SEOUL_TODAY = "2026-09-14";
const SCHEDULER_SECRET = "scheduler-secret-value";
const COMMENT_TEXT = "영상 정말 재미있게 봤습니다. 다음 편도 기대할게요!";
const SERVER_DRAFT = "봐 주셔서 감사합니다.";

const state = vi.hoisted(() => ({
  deps: null as unknown,
  hasConfig: true,
}));

vi.mock("@/lib/autoreply/real-deps", () => ({
  createAutoReplyDeps: () => {
    if (!state.deps) throw new Error("test did not set state.deps");
    return state.deps;
  },
  hasAutoReplyConfig: () => state.hasConfig,
  AUTO_REPLY_CONFIG_MESSAGE: "자동답글에 필요한 서버 설정이 아직 없습니다.",
}));

const { POST: targetPost } = await import("./target/route");
const { POST: enablePost } = await import("./enable/route");
const { POST: preparePost } = await import("./prepare/route");
const { POST: sendPost } = await import("./send/route");
const { POST: runPost } = await import("./run/route");
const { POST: stopPost } = await import("./stop/route");
const { GET: statusGet } = await import("./status/route");

interface Harness {
  deps: AutoReplyDeps;
  store: FakeAutoReplyStore;
  replies: FakeReplyClient;
  gemini: FakeGeminiClient;
  /**
   * The script the fake YouTube client reads on every call, so a test can make a
   * newer comment appear partway through — the only way to exercise a baseline
   * that was stamped a moment ago.
   */
  youtubeScript: { comments?: CommentsListResult };
}

interface HarnessOptions {
  enabled?: boolean;
  commentIds?: readonly string[];
  /** When a test needs the clock to move between two requests. */
  now?: () => Date;
  publishedAt?: string;
  /** For the two ways verifying an unprepared target can refuse it. */
  myChannelId?: string;
  privacyStatus?: string;
}

function harness(options: HarnessOptions = {}): Harness {
  const store = new FakeAutoReplyStore(
    // enabled: false means nothing at all is stored — no channel, no video, no
    // baseline. That is the state a person's first manual preview starts from.
    options.enabled === false
      ? {}
      : { enabled: true, channelId: CHANNEL_ID, videoId: VIDEO_ID, activatedAt: ACTIVATED_AT },
  );
  const replies = new FakeReplyClient({
    insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }),
  });
  const gemini = new FakeGeminiClient({
    classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
    draft: () => ({ draft: SERVER_DRAFT }),
    contextCheck: () => ({ passed: true, reason: "문맥에 맞습니다." }),
  });
  const youtubeScript = {
    myChannelId: options.myChannelId ?? CHANNEL_ID,
    video: fakeVideo({
      videoId: VIDEO_ID,
      channelId: CHANNEL_ID,
      privacyStatus: options.privacyStatus ?? "public",
    }),
    comments: {
      kind: "ok",
      comments: (options.commentIds ?? ["C_1"]).map((id) =>
        fakeComment({
          threadId: `THREAD_${id}`,
          topLevelCommentId: id,
          text: COMMENT_TEXT,
          publishedAt: options.publishedAt ?? "2026-09-14T08:00:00.000Z",
        }),
      ),
      nextPageToken: null,
      skippedCount: 0,
    } as CommentsListResult,
  };
  const deps: AutoReplyDeps = {
    store,
    replies,
    gemini,
    youtube: new FakeYoutubeClient(youtubeScript),
    now: options.now ?? (() => NOW),
  };
  state.deps = deps;
  return { deps, store, replies, gemini, youtubeScript };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/auto-reply/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/auto-reply/${path}`, { method: "GET", headers });
}

interface PreviewBody {
  status: string;
  outcome: string;
  sentCount: number;
  targetCommentId: string | null;
  draft: string | null;
  approvalToken: string | null;
  targetPrepared: boolean;
  skipped: Array<{ topLevelCommentId: string; reason: string }>;
}

/**
 * Phase one of an approval: exactly what a person's screen would be given,
 * including the token it has to hand back. Every send test below goes through
 * this rather than inventing a token, because that is the only way a request
 * can carry one at all.
 */
async function prepare(commentId = "C_1", videoId = VIDEO_ID): Promise<PreviewBody> {
  const response = await preparePost(
    post("prepare", { videoId, topLevelCommentId: commentId }),
  );
  return (await response.json()) as PreviewBody;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * Written through a cast because some type declarations describe NODE_ENV as a
 * read-only union. The value is restored after every test.
 */
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

beforeEach(() => {
  state.deps = null;
  state.hasConfig = true;
  delete process.env.AUTO_REPLY_SCHEDULER_SECRET;
  delete process.env.AUTO_REPLY_OPERATOR_SECRET;
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
  delete process.env.AUTO_REPLY_SCHEDULER_SECRET;
  delete process.env.AUTO_REPLY_OPERATOR_SECRET;
});

describe("POST /api/auto-reply/run — the scheduled endpoint", () => {
  it("refuses every caller while no scheduler secret is configured, and touches nothing", async () => {
    const { store, replies } = harness();

    const response = await runPost(post("run", {}));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reason).toBe("secret_not_configured");
    // Nothing was read and nothing was sent: the refusal is before any work.
    expect(store.calls).toEqual([]);
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses a caller with the wrong secret", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    const { store } = harness();

    const response = await runPost(post("run", {}, { Authorization: "Bearer wrong-secret-value" }));

    expect(response.status).toBe(401);
    expect(store.calls).toEqual([]);
  });

  it("refuses a caller who puts the secret in the query string instead of the header", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    harness();
    const request = new Request(
      `http://localhost/api/auto-reply/run?secret=${SCHEDULER_SECRET}`,
      { method: "POST" },
    );

    expect((await runPost(request)).status).toBe(401);
  });

  it("does not tell an unauthorized caller whether the server is even configured", async () => {
    state.hasConfig = false;
    harness();

    const response = await runPost(post("run", {}));
    const body = await response.json();

    // The auth failure comes first, so "config_missing" is not disclosed.
    expect(response.status).toBe(503);
    expect(body.reason).toBe("secret_not_configured");
  });

  it("runs and reports the outcome when the secret matches", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    const { store, replies } = harness();

    const response = await runPost(
      post("run", {}, { Authorization: `Bearer ${SCHEDULER_SECRET}` }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("sent");
    expect(body.sentCount).toBe(1);
    expect(body.replyCommentId).toBe("REPLY_1");
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_1", text: SERVER_DRAFT }]);
    expect(store.peek("C_1")?.status).toBe("SENT");
  });

  it("answers HTTP 200 with a halted outcome, so the timer does not retry the halt", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    const { store } = harness();
    state.deps = {
      ...(state.deps as AutoReplyDeps),
      replies: new FakeReplyClient({
        insert: () => ({ kind: "result_unknown", reason: "connection_interrupted" }),
      }),
    };

    const response = await runPost(
      post("run", {}, { Authorization: `Bearer ${SCHEDULER_SECRET}` }),
    );
    const body = await response.json();

    // A non-2xx is what a scheduler retries, and retrying a halt is the one
    // thing that must never happen — so the status stays 200 and the body says
    // what went wrong.
    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.outcome).toBe("halted_result_unknown");
    expect(body.sentCount).toBe(0);
    expect(body.automationEnabled).toBe(false);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
  });

  it("returns a fixed message and no store detail when the store fails", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    const { store } = harness();
    store.failNextWith = new Error(
      "fetch to https://project.supabase.co failed with key super-secret-key",
    );

    const response = await runPost(
      post("run", {}, { Authorization: `Bearer ${SCHEDULER_SECRET}` }),
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("supabase.co");
  });

  it("sends nothing at all once automation is off", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    const { store, replies } = harness();

    await stopPost(post("stop", {}));
    const response = await runPost(
      post("run", {}, { Authorization: `Bearer ${SCHEDULER_SECRET}` }),
    );
    const body = await response.json();

    expect(body.outcome).toBe("disabled");
    expect(body.sentCount).toBe(0);
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });
});

describe("POST /api/auto-reply/enable", () => {
  it("records the start time and sends zero replies, however many comments exist", async () => {
    const { store, replies, gemini } = harness({ enabled: false });

    await targetPost(post("target", { videoId: VIDEO_ID }));
    const response = await enablePost(post("enable", { videoId: VIDEO_ID, activatedAt: NOW.toISOString() }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("activated");
    expect(body.sentCount).toBe(0);
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.activatedAt).toBe(NOW.toISOString());
    // Nothing was classified and nothing was written to YouTube.
    expect(gemini.classifyCalls).toEqual([]);
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });

  it("rejects a request with no videoId", async () => {
    harness({ enabled: false });

    expect((await enablePost(post("enable", {}))).status).toBe(400);
  });

  it("refuses to activate a video of another channel", async () => {
    harness({ enabled: false });
    state.deps = {
      ...(state.deps as AutoReplyDeps),
      youtube: new FakeYoutubeClient({
        myChannelId: "UC_SOMEONE_ELSE",
        video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID }),
      }),
    };

    await targetPost(post("target", { videoId: VIDEO_ID }));
    const response = await enablePost(post("enable", { videoId: VIDEO_ID, activatedAt: NOW.toISOString() }));
    const body = await response.json();

    expect(body.outcome).toBe("channel_mismatch");
    expect(body.settings).toBeNull();
  });
});

describe("POST /api/auto-reply/prepare — showing one sentence for approval", () => {
  it("returns the exact draft and a token, and sends nothing", async () => {
    const { store, replies, gemini } = harness();

    const response = await preparePost(
      post("prepare", { videoId: VIDEO_ID, topLevelCommentId: "C_1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("ready");
    expect(body.draft).toBe(SERVER_DRAFT);
    expect(typeof body.approvalToken).toBe("string");
    expect(body.sentCount).toBe(0);
    // One draft was written, and nothing left the server for YouTube.
    expect(gemini.draftCalls).toHaveLength(1);
    expect(replies.insertCalls).toEqual([]);
    // The target was already stored here, so this call wrote nothing at all —
    // no send row, no slot of the day, and no target row either.
    expect(body.targetPrepared).toBe(false);
    expect(store.sendCount()).toBe(0);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(0);
    expect(store.calls).not.toContain("prepareTarget");
    expect(store.calls).not.toContain("claimSend");
    expect(store.calls).not.toContain("beginSend");
  });

  it("requires explicit target preparation before the first draft", async () => {
    const { store, replies } = harness({ enabled: false });
    expect((await prepare()).outcome).toBe("not_configured");
    expect(store.calls).not.toContain("prepareTarget");
    const response = await targetPost(post("target", { videoId: VIDEO_ID }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sentCount).toBe(0);
    expect(body.settings).toMatchObject({ videoId: VIDEO_ID, activatedAt: NOW.toISOString(), enabled: false });
    expect((await prepare()).outcome).toBe("not_eligible");
    expect(replies.insertCalls).toHaveLength(0);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(0);
  });

  it("refuses to re-point an already stored target, and stores nothing", async () => {
    const { store } = harness();
    const callsBefore = store.calls.length;

    const response = await preparePost(
      post("prepare", { videoId: "SOME_OTHER_VIDEO", topLevelCommentId: "C_1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.outcome).toBe("video_not_approved");
    expect(body.targetPrepared).toBe(false);
    // Which video the timer answers changes only by an explicit /enable.
    expect(store.calls.slice(callsBefore)).not.toContain("prepareTarget");
  });

  it("will not store somebody else's video as the target", async () => {
    const { store } = harness({ enabled: false, myChannelId: "UC_SOMEONE_ELSE" });

    const response = await targetPost(
      post("target", { videoId: VIDEO_ID }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).outcome).toBe("channel_mismatch");
    // Preparing checks ownership exactly as /enable does, and stops as early.
    expect(store.calls).not.toContain("prepareTarget");
  });

  it("will not store a private video as the target", async () => {
    const { store } = harness({ enabled: false, privacyStatus: "private" });

    const response = await targetPost(
      post("target", { videoId: VIDEO_ID }),
    );

    expect(response.status).toBe(403);
    expect((await response.json()).outcome).toBe("privacy_blocked");
    expect(store.calls).not.toContain("prepareTarget");
  });

  it("carries a person from nothing stored to one sent reply with the schedule off", async () => {
    let clock = new Date("2026-09-14T09:00:00.000Z");
    const { store, replies, youtubeScript } = harness({
      enabled: false,
      now: () => clock,
    });

    // 1. The first look stores the target. Nothing is eligible yet, because the
    //    baseline was stamped now.
    const first = await (await targetPost(post("target", { videoId: VIDEO_ID }))).json();
    expect(first.sentCount).toBe(0);
    expect(first.settings.enabled).toBe(false);

    // 2. A new comment arrives after that baseline, and time moves on.
    youtubeScript.comments = {
      kind: "ok",
      comments: [
        fakeComment({
          threadId: "THREAD_C_2",
          topLevelCommentId: "C_2",
          text: COMMENT_TEXT,
          publishedAt: "2026-09-14T09:30:00.000Z",
        }),
      ],
      nextPageToken: null,
      skippedCount: 0,
    };
    clock = new Date("2026-09-14T10:00:00.000Z");

    // 3. Now a draft appears, and this time nothing new is stored.
    const second = await prepare("C_2");
    expect(second.outcome).toBe("ready");
    expect(second.targetPrepared).toBe(false);
    expect(second.draft).toBe(SERVER_DRAFT);

    // 4. The person approves, and the reply goes out — with the timer never on.
    const sent = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_2",
        approvalToken: second.approvalToken,
      }),
    );
    const sentBody = await sent.json();

    expect(sent.status).toBe(200);
    expect(sentBody.outcome).toBe("sent");
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_2", text: second.draft }]);
    // The schedule was never enabled at any point in the four steps above.
    expect(store.calls).not.toContain("enableSchedule");
    expect(sentBody.automationEnabled).toBe(false);
  });

  it("does not turn the schedule on", async () => {
    const { store } = harness();
    await stopPost(post("stop", {}));
    const callsAfterStop = store.calls.length;

    const body = await prepare();

    expect(body.outcome).toBe("ready");
    // Enabling stays an explicit separate press of /enable. Preparing a reply
    // for a person to read must never be a way to restart the timer.
    expect(store.calls.slice(callsAfterStop)).not.toContain("enableSchedule");
    const status = await statusGet(get("status"));
    expect((await status.json()).settings.enabled).toBe(false);
  });

  it("never returns the comment's own text", async () => {
    harness();

    const response = await preparePost(
      post("prepare", { videoId: VIDEO_ID, topLevelCommentId: "C_1" }),
    );
    const serialized = JSON.stringify(await response.json());

    // The outgoing sentence is the point of this route; the viewer's text is
    // not, and the token carries a digest of it rather than the text.
    expect(serialized).toContain(SERVER_DRAFT);
    expect(serialized).not.toContain(COMMENT_TEXT);
  });

  it("has no draft and no token for a comment that already has a record", async () => {
    const { store, gemini } = harness();
    store.seedSend({
      topLevelCommentId: "C_1",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_OLD",
      sendDay: SEOUL_TODAY,
      claimedAt: "2026-09-14T05:00:00.000Z",
      resolvedAt: "2026-09-14T05:00:01.000Z",
      lockExpiresAt: "2026-09-14T05:10:00.000Z",
    });

    const response = await preparePost(
      post("prepare", { videoId: VIDEO_ID, topLevelCommentId: "C_1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("already_recorded");
    expect(body.draft).toBeNull();
    expect(body.approvalToken).toBeNull();
    expect(gemini.draftCalls).toEqual([]);
  });

  it("refuses a video that is not the approved one, and an unknown comment", async () => {
    harness();

    const otherVideo = await preparePost(
      post("prepare", { videoId: "SOME_OTHER_VIDEO", topLevelCommentId: "C_1" }),
    );
    expect(otherVideo.status).toBe(403);
    expect((await otherVideo.json()).outcome).toBe("video_not_approved");

    const unknownComment = await preparePost(
      post("prepare", { videoId: VIDEO_ID, topLevelCommentId: "C_MISSING" }),
    );
    expect(unknownComment.status).toBe(404);
    expect((await unknownComment.json()).outcome).toBe("comment_not_found");
  });

  it("rejects a body with no comment id", async () => {
    harness();

    expect((await preparePost(post("prepare", { videoId: VIDEO_ID }))).status).toBe(400);
  });
});

describe("POST /api/auto-reply/send — one approved reply", () => {
  it("posts the sentence from the preview, byte for byte", async () => {
    const { replies, gemini } = harness();

    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.outcome).toBe("sent");
    // The exact string the preview handed the screen is the exact string that
    // reached comments.insert, and no second draft was written — a fresh one
    // would be a different sentence, and then nothing would connect what a
    // person read to what went out.
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_1", text: preview.draft }]);
    expect(preview.draft).toBe(SERVER_DRAFT);
    expect(gemini.draftCalls).toHaveLength(1);
  });

  it("refuses to send without an approval token, whatever text the body carries", async () => {
    const { store, replies } = harness();

    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        // An attempt to make approval mean "post this text for me".
        text: "제 채널도 구독해 주세요! http://spam.example",
        draft: "제 채널도 구독해 주세요! http://spam.example",
      }),
    );

    expect(response.status).toBe(400);
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });

  it("ignores any text in the request and posts the signed sentence instead", async () => {
    const { replies } = harness();

    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
        text: "제 채널도 구독해 주세요! http://spam.example",
        draft: "제 채널도 구독해 주세요! http://spam.example",
      }),
    );
    const body = await response.json();

    expect(body.outcome).toBe("sent");
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_1", text: SERVER_DRAFT }]);
    expect(JSON.stringify(body)).not.toContain("spam.example");
  });

  it("refuses a token that was tampered with", async () => {
    const { store, replies } = harness();

    const preview = await prepare();
    const [version, payload, signature] = (preview.approvalToken ?? "").split(".");
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: `${version}.${payload}X.${signature}`,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.outcome).toBe("approval_invalid");
    expect(body.approvalIssue).toBe("bad_signature");
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });

  it("refuses a token that is not one this server issued at all", async () => {
    const { replies } = harness();

    const response = await sendPost(
      post("send", { videoId: VIDEO_ID, topLevelCommentId: "C_1", approvalToken: "nonsense" }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.approvalIssue).toBe("malformed");
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses an approval that sat around too long", async () => {
    const { replies } = harness();

    const preview = await prepare();
    // The same page, submitted after the approval's short life ran out.
    state.deps = {
      ...(state.deps as AutoReplyDeps),
      now: () => new Date(NOW.getTime() + (APPROVAL_TTL_SECONDS + 1) * 1000),
    };
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.approvalIssue).toBe("expired");
    expect(replies.insertCalls).toEqual([]);
  });

  it("refuses a token issued for a different comment", async () => {
    const { replies } = harness({ commentIds: ["C_1", "C_2"] });

    const preview = await prepare("C_1");
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_2",
        approvalToken: preview.approvalToken,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.approvalIssue).toBe("comment_mismatch");
    expect(replies.insertCalls).toEqual([]);
  });

  it("echoes ids only — never the comment's text or the reply's text", async () => {
    harness();

    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );
    const serialized = JSON.stringify(await response.json());

    expect(serialized).toContain("C_1");
    expect(serialized).toContain("REPLY_1");
    expect(serialized).not.toContain(COMMENT_TEXT);
    // Not even the sentence that was just sent: the preview response is where
    // a person reads it, and this route runs on a deployed server.
    expect(serialized).not.toContain(SERVER_DRAFT);
  });

  it("refuses a video that is not the approved one", async () => {
    harness();

    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: "SOME_OTHER_VIDEO",
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );

    expect((await response.json()).outcome).toBe("video_not_approved");
    expect(response.status).toBe(403);
  });

  it("allows approved sending after five earlier attempts", async () => {
    const { store, replies } = harness();
    store.seedReserved(SEOUL_TODAY, 5);

    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );

    expect((await response.json()).outcome).toBe("sent");
    expect(response.status).toBe(200);
    expect(replies.insertCalls).toHaveLength(1);
  });

  it("still sends one approved reply while the schedule is off", async () => {
    const { store, replies } = harness();

    await stopPost(post("stop", {}));
    const preview = await prepare();
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );
    const body = await response.json();

    // Turning the timer off is not a statement about this one reply — a person
    // asked for it. What it must not do is turn the timer back on.
    expect(response.status).toBe(200);
    expect(body.outcome).toBe("sent");
    expect(body.automationEnabled).toBe(false);
    expect(replies.insertCalls).toEqual([{ parentCommentId: "C_1", text: SERVER_DRAFT }]);
    expect(store.peek("C_1")?.status).toBe("SENT");
    const status = await statusGet(get("status"));
    expect((await status.json()).settings.enabled).toBe(false);
  });

  it("sends nothing while a halt is on record, approval or not", async () => {
    const { store, replies } = harness();

    const preview = await prepare();
    // An earlier send whose result was never observed leaves this state.
    await store.stop({ stoppedAt: NOW.toISOString(), reason: "result_unknown" });
    const response = await sendPost(
      post("send", {
        videoId: VIDEO_ID,
        topLevelCommentId: "C_1",
        approvalToken: preview.approvalToken,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.outcome).toBe("halted");
    expect(replies.insertCalls).toEqual([]);
    expect(store.sendCount()).toBe(0);
  });

  it("rejects a body with no comment id", async () => {
    harness();

    expect((await sendPost(post("send", { videoId: VIDEO_ID }))).status).toBe(400);
  });
});

describe("GET /api/auto-reply/status", () => {
  it("reports the switch, the day's slot use, and records made of ids only", async () => {
    const { store } = harness();
    store.seedSend({
      topLevelCommentId: "C_OLD",
      videoId: VIDEO_ID,
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_OLD",
      sendDay: SEOUL_TODAY,
      claimedAt: "2026-09-14T05:00:00.000Z",
      resolvedAt: "2026-09-14T05:00:01.000Z",
      lockExpiresAt: "2026-09-14T05:10:00.000Z",
    });

    const response = await statusGet(get("status"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.settings.enabled).toBe(true);
    expect(body.sendDay).toBe(SEOUL_TODAY);
    expect(body).not.toHaveProperty("dailyLimit");
    expect(body.dayCounts).toEqual({ reservedCount: 1, sentCount: 1 });
    expect(body.recentSends).toHaveLength(1);
    expect(Object.keys(body.recentSends[0]).sort()).toEqual([
      "claimedAt",
      "lockExpiresAt",
      "reason",
      "replyCommentId",
      "resolvedAt",
      "sendDay",
      "status",
      "topLevelCommentId",
      "videoId",
    ]);
  });
});

describe("the operator endpoints on a deployed server", () => {
  beforeEach(() => {
    setNodeEnv("production");
  });

  it("all require a secret, and none of them acts without one", async () => {
    const { store, replies } = harness();

    const responses = [
      await targetPost(post("target", { videoId: VIDEO_ID })),
      await enablePost(post("enable", { videoId: VIDEO_ID, activatedAt: NOW.toISOString() })),
      await preparePost(post("prepare", { videoId: VIDEO_ID, topLevelCommentId: "C_1" })),
      await sendPost(
        post("send", {
          videoId: VIDEO_ID,
          topLevelCommentId: "C_1",
          approvalToken: "does-not-matter",
        }),
      ),
      await stopPost(post("stop", {})),
      await statusGet(get("status")),
    ];

    for (const response of responses) {
      expect(response.status).toBe(503);
      expect((await response.json()).reason).toBe("secret_not_configured");
    }
    expect(store.calls).toEqual([]);
    expect(replies.insertCalls).toEqual([]);
  });

  it("accept the operator secret from the Authorization header", async () => {
    process.env.AUTO_REPLY_OPERATOR_SECRET = "operator-secret";
    harness();

    const response = await statusGet(get("status", { Authorization: "Bearer operator-secret" }));

    expect(response.status).toBe(200);
  });
});

describe("a server that is not configured yet", () => {
  it("says so plainly to an authorized caller, and never starts a run", async () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SCHEDULER_SECRET;
    state.hasConfig = false;
    const { store } = harness();

    const response = await runPost(
      post("run", {}, { Authorization: `Bearer ${SCHEDULER_SECRET}` }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.reason).toBe("config_missing");
    expect(store.calls).toEqual([]);
  });
});

describe("safe recent run status", () => {
  it("distinguishes zero-send completion, errors and an interrupted run without text", async () => {
    const { store } = harness();
    await store.beginRun({ runId: "RUN_ZERO", trigger: "scheduled", startedAt: "2026-09-14T01:00:00Z" });
    await store.finishRun({ runId: "RUN_ZERO", completedAt: "2026-09-14T01:00:01Z", outcome: "no_target", consideredCount: 0, deferredCount: 0, humanReviewCount: 0, failureCount: 0, sentCount: 0, automationEnabled: true, cursorHasMore: false });
    await store.beginRun({ runId: "RUN_ERROR", trigger: "manual", startedAt: "2026-09-14T02:00:00Z" });
    await store.finishRun({ runId: "RUN_ERROR", completedAt: "2026-09-14T02:00:01Z", outcome: "run_failed", consideredCount: 1, deferredCount: 0, humanReviewCount: 1, failureCount: 1, sentCount: 0, automationEnabled: false, cursorHasMore: false });
    await store.beginRun({ runId: "RUN_INTERRUPTED", trigger: "scheduled", startedAt: "2026-09-14T03:00:00Z" });
    const response = await statusGet(get("status"));
    const body = await response.json();
    expect(body.recentRuns).toHaveLength(3);
    expect(body.recentRuns[0]).toMatchObject({ runId: "RUN_INTERRUPTED", completedAt: null, outcome: null });
    expect(body.recentRuns[1]).toMatchObject({ trigger: "manual", outcome: "run_failed", failureCount: 1 });
    expect(body.recentRuns[2]).toMatchObject({ outcome: "no_target", sentCount: 0, completedAt: "2026-09-14T01:00:01Z" });
    expect(JSON.stringify(body.recentRuns)).not.toContain(COMMENT_TEXT);
    expect(JSON.stringify(body.recentRuns)).not.toContain(SERVER_DRAFT);
    expect(JSON.stringify(body.recentRuns)).not.toContain(SCHEDULER_SECRET);
  });
});


describe("the baseline a person confirmed", () => {
  it("refuses an enable request whose displayed baseline has changed", async () => {
    const { store } = harness();
    await store.stop({ stoppedAt: NOW.toISOString(), reason: "manual" });
    const response = await enablePost(post("enable", { videoId: VIDEO_ID, activatedAt: NOW.toISOString() }));
    expect(response.status).toBe(409);
    expect((await store.readSettings()).enabled).toBe(false);
    const accepted = await enablePost(post("enable", { videoId: VIDEO_ID, activatedAt: ACTIVATED_AT }));
    expect(accepted.status).toBe(200);
    expect((await store.readSettings()).enabled).toBe(true);
  });
});
