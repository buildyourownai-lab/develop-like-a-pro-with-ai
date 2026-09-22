import { describe, expect, it } from "vitest";
import { FakeGeminiClient } from "../gemini/__fixtures__/fake-client";
import { FakeReplyClient, FakeYoutubeClient, fakeComment, fakeVideo } from "../youtube/__fixtures__/fake-clients";
import { FakeAutoReplyStore } from "./__fixtures__/fake-store";
import { SEND_LEASE_SECONDS } from "./policy";
import { AutoReplyDeps, attemptSend, runScheduledAutoReply } from "./runner";

/**
 * What happens when two runs overlap.
 *
 * This is the case a scheduled job makes ordinary rather than exotic: a run
 * that takes longer than the interval is still going when the next one starts.
 * Three things must hold no matter how the two interleave — the day never
 * exceeds five replies in total, one comment never gets two replies, and once a
 * send's result is unknown nothing else gets inserted.
 *
 * The guarantees live in two atomic database statements, and there is a
 * division of labour between them worth keeping in mind while reading these
 * tests. ch20_begin_send hands out ONE global lease, so overlapping attempts do
 * not run their sends at the same time at all. ch20_claim_send is what makes the
 * limits true even when attempts do not overlap — an expired lease, a restarted
 * process, or a person clicking send an hour later.
 *
 * FakeAutoReplyStore models exactly that: both methods decide and write with no
 * await in between, the same way the SQL functions decide and write inside one
 * transaction holding a row lock. So a test that passes here is testing the
 * shape of the real rule, not a convenient fiction.
 */

const CHANNEL_ID = "UC_MINE";
const VIDEO_ID = "VIDEO_1";
const ACTIVATED_AT = "2026-09-14T00:00:00.000Z";
const NOW = new Date("2026-09-14T09:00:00.000Z");
const SEOUL_TODAY = "2026-09-14";
const LEASE_MS = SEND_LEASE_SECONDS * 1000;

function activeStore(): FakeAutoReplyStore {
  return new FakeAutoReplyStore({
    enabled: true,
    channelId: CHANNEL_ID,
    videoId: VIDEO_ID,
    activatedAt: ACTIVATED_AT,
  });
}

function depsFor(
  store: FakeAutoReplyStore,
  replies: FakeReplyClient,
  comments: string[],
  now: Date = NOW,
): AutoReplyDeps {
  return {
    store,
    replies,
    youtube: new FakeYoutubeClient({
      myChannelId: CHANNEL_ID,
      video: fakeVideo({ videoId: VIDEO_ID, channelId: CHANNEL_ID }),
      comments: {
        kind: "ok",
        comments: comments.map((id, index) =>
          fakeComment({
            threadId: `THREAD_${id}`,
            topLevelCommentId: id,
            publishedAt: new Date(Date.parse("2026-09-14T04:00:00.000Z") + index * 60_000).toISOString(),
          }),
        ),
        nextPageToken: null,
        skippedCount: 0,
      },
    }),
    gemini: new FakeGeminiClient({
      classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: () => ({ draft: "봐 주셔서 감사합니다." }),
      contextCheck: () => ({ passed: true, reason: "문맥에 맞습니다." }),
    }),
    now: () => now,
  };
}

function target(topLevelCommentId: string) {
  return {
    topLevelCommentId,
    videoId: VIDEO_ID,
    draft: "감사합니다.",
    reason: "GENERAL_REACTION",
  };
}

describe("the one global send lease", () => {
  it("lets a single overlapping attempt send and refuses the others outright", async () => {
    const store = activeStore();
    let replyCounter = 0;
    const replies = new FakeReplyClient({
      insert: () => {
        replyCounter += 1;
        return { kind: "ok", replyCommentId: `REPLY_${replyCounter}` };
      },
    });

    const attempts = await Promise.all(
      ["C_A", "C_B", "C_C", "C_D"].map((id) =>
        attemptSend(target(id), depsFor(store, replies, [id])),
      ),
    );

    expect(attempts.filter((attempt) => attempt.outcome === "sent")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.outcome === "send_in_progress")).toHaveLength(3);
    expect(replies.insertCalls).toHaveLength(1);
    // A refused attempt reserved nothing and wrote no row, so the three that
    // lost the race cost the day nothing at all.
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    expect(store.sendCount()).toBe(1);
    // And the lease is handed back, so the next run is not locked out.
    expect(store.peekLease()).toBeNull();
  });

  it("still cannot push the Asia/Seoul day past five once the lease stops overlapping", async () => {
    const store = activeStore();
    let replyCounter = 0;
    const replies = new FakeReplyClient({
      insert: () => {
        replyCounter += 1;
        return { kind: "ok", replyCommentId: `REPLY_${replyCounter}` };
      },
    });

    // Seven attempts, one after another, so the lease refuses none of them and
    // the only thing standing between them and a sixth reply is the day's
    // counter inside claimSend.
    const outcomes: string[] = [];
    for (const id of ["C_1", "C_2", "C_3", "C_4", "C_5", "C_6", "C_7"]) {
      const at = new Date(NOW.getTime() - 3 * 60 * 60_000 + outcomes.length * 61 * 60_000);
      const attempt = await attemptSend(target(id), depsFor(store, replies, [id], at));
      outcomes.push(attempt.outcome);
    }

    expect(outcomes.filter((outcome) => outcome === "sent")).toHaveLength(7);
    expect(outcomes).toEqual(Array(7).fill("sent"));
    expect(replies.insertCalls).toHaveLength(7);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(7);
  });

  it("refuses takeover even after a lease deadline", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }),
    });
    // A send that never handed its lease back — the process died mid-attempt.
    await store.beginSend({
      holder: "STUCK",
      requireEnabled: true,
      now: NOW.toISOString(),
      leaseExpiresAt: new Date(NOW.getTime() + LEASE_MS).toISOString(),
    });

    const during = await attemptSend(
      target("C_A"),
      depsFor(store, replies, ["C_A"], new Date(NOW.getTime() + LEASE_MS - 1_000)),
    );
    expect(during.outcome).toBe("send_in_progress");
    expect(replies.insertCalls).toHaveLength(0);

    const after = await attemptSend(
      target("C_A"),
      depsFor(store, replies, ["C_A"], new Date(NOW.getTime() + LEASE_MS + 1_000)),
    );
    expect(after.outcome).toBe("send_in_progress");
    expect(replies.insertCalls).toHaveLength(0);
    expect(store.peekLease()).toBe("STUCK");
  });
});

describe("two runs racing on the same comment", () => {
  it("sends exactly one reply and spends exactly one slot", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });

    const attempts = await Promise.all(
      [0, 1, 2, 3, 4].map(() => attemptSend(target("C_SAME"), depsFor(store, replies, ["C_SAME"]))),
    );

    expect(attempts.filter((attempt) => attempt.outcome === "sent")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.outcome === "send_in_progress")).toHaveLength(4);
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
  });

  it("refuses the same comment afterwards on the row, not on the lease", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });

    const first = await attemptSend(target("C_SAME"), depsFor(store, replies, ["C_SAME"]));
    expect(first.outcome).toBe("sent");

    // Sequential, so every one of these holds the lease in turn and is refused
    // by the row it finds. This is the guard that survives a restart, a lease
    // expiring, and a person pressing send tomorrow.
    const later = [];
    for (const _ of [0, 1, 2]) {
      later.push(await attemptSend(target("C_SAME"), depsFor(store, replies, ["C_SAME"])));
    }

    expect(later.map((attempt) => attempt.outcome)).toEqual([
      "already_recorded",
      "already_recorded",
      "already_recorded",
    ]);
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
  });

  it("does the same when whole runs overlap on one comment", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY_1" }) });

    const reports = await Promise.all([
      runScheduledAutoReply(depsFor(store, replies, ["C_SAME"])),
      runScheduledAutoReply(depsFor(store, replies, ["C_SAME"])),
      runScheduledAutoReply(depsFor(store, replies, ["C_SAME"])),
    ]);

    expect(reports.reduce((sum, report) => sum + report.sentCount, 0)).toBe(1);
    expect(replies.insertCalls).toEqual([
      { parentCommentId: "C_SAME", text: "봐 주셔서 감사합니다." },
    ]);
  });
});

describe("whole runs and the shared daily limit", () => {
  it("keeps concurrent runs to one reply between them", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY" }) });

    // Three concurrent runs, each looking at a different comment.
    const reports = await Promise.all([
      runScheduledAutoReply(depsFor(store, replies, ["C_X"])),
      runScheduledAutoReply(depsFor(store, replies, ["C_Y"])),
      runScheduledAutoReply(depsFor(store, replies, ["C_Z"])),
    ]);

    expect(reports.reduce((sum, report) => sum + report.sentCount, 0)).toBe(1);
    expect(reports.filter((report) => report.outcome === "send_in_progress")).toHaveLength(2);
    expect(replies.insertCalls).toHaveLength(1);
    // Each run still recorded that it happened, including the two that sent
    // nothing — a lease refusal is a run, not a lost run.
    expect(store.runCount()).toBe(3);
  });

  it("keeps runs that do not overlap inside the same day's five", async () => {
    const store = activeStore();
    store.seedReserved(SEOUL_TODAY, 4);
    const replies = new FakeReplyClient({ insert: () => ({ kind: "ok", replyCommentId: "REPLY" }) });

    const outcomes: string[] = [];
    for (const id of ["C_X", "C_Y", "C_Z"]) {
      outcomes.push((await runScheduledAutoReply(depsFor(store, replies, [id]))).outcome);
    }

    expect(outcomes).toEqual(["sent", "needs_review", "needs_review"]);
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(5);
  });
});

describe("a halt during a race", () => {
  it("does not free the unobserved send's slot for another run to take", async () => {
    const store = activeStore();
    store.seedReserved(SEOUL_TODAY, 4);
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "result_unknown", reason: "connection_interrupted" }),
    });

    const attempts = await Promise.all(
      ["C_A", "C_B"].map((id) => attemptSend(target(id), depsFor(store, replies, [id]))),
    );

    expect(attempts.filter((a) => a.outcome === "halted_result_unknown")).toHaveLength(1);
    // The one that lost the lease never reached comments.insert at all, which is
    // the point of the lease: there is no window in which a second send goes out
    // while the first one's result is still unknown.
    expect(attempts.filter((a) => a.outcome === "send_in_progress")).toHaveLength(1);
    expect(replies.insertCalls).toHaveLength(1);
    // The slot stays spent, and automation is off for whatever runs next.
    expect(store.reservedOn(SEOUL_TODAY)).toBe(5);
    expect((await store.readSettings()).enabled).toBe(false);
    expect((await store.readSettings()).stopReason).toBe("result_unknown");
  });

  it("refuses every later attempt, the timer's and a person's alike", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({
      insert: () => ({ kind: "result_unknown", reason: "connection_interrupted" }),
    });

    const halted = await attemptSend(target("C_A"), depsFor(store, replies, ["C_A"]));
    expect(halted.outcome).toBe("halted_result_unknown");
    // The halt gave the lease back, so what stops the next attempt is the
    // recorded halt and not a lease nobody released.
    expect(store.peekLease()).toBeNull();

    const scheduled = await attemptSend(target("C_B"), depsFor(store, replies, ["C_B"]), {
      requireEnabled: true,
    });
    // requireEnabled false is the manual path: a person's approval outranks the
    // schedule switch, and still does not outrank a halt.
    const manual = await attemptSend(target("C_C"), depsFor(store, replies, ["C_C"]), {
      requireEnabled: false,
    });

    expect(scheduled.outcome).toBe("halted");
    expect(manual.outcome).toBe("halted");
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.sendCount()).toBe(1);
  });
});

describe("unresolved sends fail closed", () => {
  it("keeps A pending past 121 seconds and never inserts B", async () => {
    const store = activeStore();
    let complete!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { complete = resolve; });
    const replies = new FakeReplyClient({ insert: async () => {
      entered();
      await pending;
      return { kind: "result_unknown", reason: "connection_interrupted" };
    } });
    const a = attemptSend(target("C_A"), depsFor(store, replies, ["C_A"]));
    await started;
    const b = await attemptSend(target("C_B"), depsFor(store, replies, ["C_B"], new Date(NOW.getTime() + 121_000)));
    expect(b.outcome).toBe("send_in_progress");
    expect(replies.insertCalls).toHaveLength(1);
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    complete();
    expect((await a).outcome).toBe("halted_result_unknown");
    await store.stop({ stoppedAt: NOW.toISOString(), reason: "manual" });
    await store.enableSchedule({ at: NOW.toISOString(), videoId: VIDEO_ID, activatedAt: ACTIVATED_AT });
    expect((await store.readSettings()).stopReason).toBe("result_unknown");
    const c = await attemptSend(target("C_C"), depsFor(store, replies, ["C_C"]), { requireEnabled: false });
    expect(c.outcome).toBe("halted");
    expect(replies.insertCalls).toHaveLength(1);
  });

  it("keeps the lease and quota when the post succeeded but the DB write failed", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => {
      store.finalizeSent = async () => { throw new Error("storage unavailable"); };
      store.haltOnResultUnknown = async () => { throw new Error("storage unavailable"); };
      return { kind: "ok", replyCommentId: "R_A" };
    } });
    await expect(attemptSend(target("C_A"), depsFor(store, replies, ["C_A"]))).rejects.toThrow("storage unavailable");
    expect(store.peekLease()).not.toBeNull();
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    expect((await attemptSend(target("C_B"), depsFor(store, replies, ["C_B"], new Date(NOW.getTime() + 121_000)))).outcome).toBe("send_in_progress");
    expect(replies.insertCalls).toHaveLength(1);
  });

  it("treats an unexpected post exception as unknown and never refunds", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient({ insert: () => { throw new Error("timeout"); } });
    expect((await attemptSend(target("C_A"), depsFor(store, replies, ["C_A"]))).outcome).toBe("halted_result_unknown");
    expect(store.reservedOn(SEOUL_TODAY)).toBe(1);
    expect(store.peek("C_A")?.status).toBe("RESULT_UNKNOWN");
  });

  it("refuses an old target after another target was prepared", async () => {
    const store = activeStore();
    const replies = new FakeReplyClient();
    await store.prepareTarget({ channelId: CHANNEL_ID, videoId: "VIDEO_2", activatedAt: NOW.toISOString() });
    expect((await store.readSettings()).enabled).toBe(false);
    const result = await attemptSend(target("C_A"), depsFor(store, replies, ["C_A"]), { requireEnabled: false });
    expect(result.outcome).toBe("not_configured");
    expect(replies.insertCalls).toHaveLength(0);
  });
});
