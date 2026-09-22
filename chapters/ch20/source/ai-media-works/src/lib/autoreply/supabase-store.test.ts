import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Supabase adapter against a mocked fetch. Two things are being checked:
 * that each method calls the one database function it should with the arguments
 * it should, and — the reason this file matters more than a normal mapping test
 * — that the service role key never leaves the Authorization and apikey
 * headers. A key in a URL ends up in access logs and browser history; a key in
 * an error message ends up in a server log.
 */

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

const STORE_URL = "https://example-project.supabase.co";
const SERVICE_KEY = "service-role-key-value-do-not-log";

function installFetchMock(reply: (fn: string, body: unknown) => { status: number; body: unknown }) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body,
    });
    const fn = url.pathname.replace("/rest/v1/rpc/", "");
    const answer = reply(fn, body);
    return {
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: async () => answer.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

async function loadStore() {
  const { createSupabaseAutoReplyStore } = await import("./supabase-store");
  return createSupabaseAutoReplyStore();
}

/**
 * vi.resetModules() gives every test a fresh module graph, so the error classes
 * the adapter throws are the ones from that graph — not the ones a top-level
 * import of ./errors would have captured before the reset. instanceof compares
 * class identity, so the classes have to be loaded from the same graph as the
 * adapter under test.
 */
async function loadErrors() {
  return import("./errors");
}

const SETTINGS_ROW = {
  enabled: true,
  channelId: "UC_MINE",
  videoId: "VIDEO_1",
  activatedAt: "2026-09-14T00:00:00.000Z",
  stoppedAt: null,
  stopReason: null,
};

beforeEach(() => {
  vi.resetModules();
  process.env.SUPABASE_URL = STORE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

describe("where the key goes", () => {
  it("sends it in headers only, never in the URL or the body", async () => {
    const { calls } = installFetchMock(() => ({ status: 200, body: SETTINGS_ROW }));
    const store = await loadStore();

    await store.readSettings();

    const [call] = calls;
    expect(call?.url).toBe(`${STORE_URL}/rest/v1/rpc/ch20_read_settings`);
    // No query string at all, so no argument or key can be logged by a proxy.
    expect(new URL(call?.url ?? "").search).toBe("");
    expect(call?.url).not.toContain(SERVICE_KEY);
    expect(JSON.stringify(call?.body)).not.toContain(SERVICE_KEY);
    expect(call?.headers.apikey).toBe(SERVICE_KEY);
    expect(call?.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(call?.method).toBe("POST");
  });

  it("keeps the key and the URL out of the error it throws when the store is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`getaddrinfo ENOTFOUND ${STORE_URL} with key ${SERVICE_KEY}`);
      }),
    );
    const store = await loadStore();
    const { AutoReplyStoreRequestError } = await loadErrors();

    await expect(store.readSettings()).rejects.toBeInstanceOf(AutoReplyStoreRequestError);
    await expect(store.readSettings()).rejects.toThrow(/^ch20_read_settings request failed\.$/);
  });

  it("keeps the key out of the error it throws on an HTTP failure", async () => {
    installFetchMock(() => ({ status: 500, body: { message: `key ${SERVICE_KEY} rejected` } }));
    const store = await loadStore();
    const { AutoReplyStoreRequestError } = await loadErrors();

    const error = await store.readSettings().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AutoReplyStoreRequestError);
    expect((error as Error).message).toBe("ch20_read_settings returned HTTP 500.");
    expect((error as Error).message).not.toContain(SERVICE_KEY);
  });

  it("names the missing variable without printing any value", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const store = await loadStore();
    const { AutoReplyConfigMissingError } = await loadErrors();

    const error = await store.readSettings().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AutoReplyConfigMissingError);
    expect((error as Error).message).toBe("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  });
});

describe("each method calls its own database function", () => {
  it("claims a send with all the arguments the atomic function needs", async () => {
    const { calls } = installFetchMock(() => ({
      status: 200,
      body: { kind: "claimed", sendDay: "2026-09-14", reservedCount: 3 },
    }));
    const store = await loadStore();

    const outcome = await store.claimSend({
      topLevelCommentId: "C_1",
      videoId: "VIDEO_1",
      sendDay: "2026-09-14",

      claimedAt: "2026-09-14T09:00:00.000Z",
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
      reason: "GENERAL_REACTION",
    });

    expect(outcome).toEqual({ kind: "claimed", sendDay: "2026-09-14", reservedCount: 3 });
    expect(calls[0]?.url).toBe(`${STORE_URL}/rest/v1/rpc/ch20_claim_send`);
    expect(calls[0]?.body).toEqual({
      p_top_level_comment_id: "C_1",
      p_video_id: "VIDEO_1",
      p_send_day: "2026-09-14",
      p_claimed_at: "2026-09-14T09:00:00.000Z",
      p_lock_expires_at: "2026-09-14T09:10:00.000Z",
      p_reason: "GENERAL_REACTION",
    });
    // One round trip. A read followed by a separate write would not be atomic.
    expect(calls).toHaveLength(1);
  });

  it("reads the other two claim outcomes", async () => {
    installFetchMock(() => ({ status: 200, body: { kind: "already_recorded", status: "SENT" } }));
    const recorded = await (await loadStore()).claimSend({
      topLevelCommentId: "C_1",
      videoId: "VIDEO_1",
      sendDay: "2026-09-14",

      claimedAt: "2026-09-14T09:00:00.000Z",
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
      reason: "GENERAL_REACTION",
    });
    expect(recorded).toEqual({ kind: "already_recorded", status: "SENT" });

    vi.resetModules();
    installFetchMock(() => ({
      status: 200,
      body: { kind: "claimed", sendDay: "2026-09-14", reservedCount: 6 },
    }));
    const limited = await (await loadStore()).claimSend({
      topLevelCommentId: "C_2",
      videoId: "VIDEO_1",
      sendDay: "2026-09-14",

      claimedAt: "2026-09-14T09:00:00.000Z",
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
      reason: "GENERAL_REACTION",
    });
    expect(limited).toEqual({ kind: "claimed", sendDay: "2026-09-14", reservedCount: 6 });
  });

  it("halts and reads back the disabled settings in one call", async () => {
    const { calls } = installFetchMock(() => ({
      status: 200,
      body: { ...SETTINGS_ROW, enabled: false, stoppedAt: "2026-09-14T09:00:00.000Z", stopReason: "result_unknown" },
    }));
    const store = await loadStore();

    const settings = await store.haltOnResultUnknown({
      topLevelCommentId: "C_1",
      reason: "connection_interrupted",
      resolvedAt: "2026-09-14T09:00:00.000Z",
    });

    expect(settings).toMatchObject({ enabled: false, stopReason: "result_unknown" });
    // One function, so the status change and the disable cannot be split.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("ch20_halt_on_result_unknown");
  });

  it("maps recorded statuses back into a lookup", async () => {
    installFetchMock(() => ({ status: 200, body: { C_1: "SENT", C_2: "FAILED" } }));
    const store = await loadStore();

    const found = await store.findRecordedStatuses(["C_1", "C_2", "C_3"]);

    expect([...found.entries()].sort()).toEqual([
      ["C_1", "SENT"],
      ["C_2", "FAILED"],
    ]);
  });

  it("does not call the database at all for an empty id list", async () => {
    const { calls } = installFetchMock(() => ({ status: 200, body: {} }));
    const store = await loadStore();

    expect((await store.findRecordedStatuses([])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("reads a send row's ids, status, and times", async () => {
    installFetchMock(() => ({
      status: 200,
      body: [
        {
          topLevelCommentId: "C_1",
          videoId: "VIDEO_1",
          status: "CLAIMED",
          reason: "GENERAL_REACTION",
          replyCommentId: null,
          sendDay: "2026-09-14",
          claimedAt: "2026-09-14T09:00:00.000Z",
          resolvedAt: null,
          lockExpiresAt: "2026-09-14T09:10:00.000Z",
        },
      ],
    }));
    const store = await loadStore();

    const pending = await store.listPendingSends();

    expect(pending).toEqual([
      {
        topLevelCommentId: "C_1",
        videoId: "VIDEO_1",
        status: "CLAIMED",
        reason: "GENERAL_REACTION",
        replyCommentId: null,
        sendDay: "2026-09-14",
        claimedAt: "2026-09-14T09:00:00.000Z",
        resolvedAt: null,
        lockExpiresAt: "2026-09-14T09:10:00.000Z",
      },
    ]);
    // There is no field for comment text, author, or reply text to read.
    expect(Object.keys(pending[0] ?? {})).not.toContain("text");
  });
});

describe("fail closed on an answer this app does not recognize", () => {
  it("refuses an unknown claim outcome instead of treating it as a claim", async () => {
    installFetchMock(() => ({ status: 200, body: { kind: "probably_fine" } }));
    const store = await loadStore();
    const { AutoReplyStoreResponseError } = await loadErrors();

    await expect(
      store.claimSend({
        topLevelCommentId: "C_1",
        videoId: "VIDEO_1",
        sendDay: "2026-09-14",

        claimedAt: "2026-09-14T09:00:00.000Z",
        lockExpiresAt: "2026-09-14T09:10:00.000Z",
        reason: "GENERAL_REACTION",
      }),
    ).rejects.toBeInstanceOf(AutoReplyStoreResponseError);
  });

  it("refuses a send status outside the closed set", async () => {
    installFetchMock(() => ({ status: 200, body: { C_1: "PROBABLY_SENT" } }));
    const store = await loadStore();
    const { AutoReplyStoreResponseError } = await loadErrors();

    await expect(store.findRecordedStatuses(["C_1"])).rejects.toBeInstanceOf(
      AutoReplyStoreResponseError,
    );
  });

  it("reads a missing or non-boolean enabled flag as off", async () => {
    installFetchMock(() => ({ status: 200, body: { channelId: "UC_MINE", enabled: "true" } }));
    const store = await loadStore();

    expect((await store.readSettings()).enabled).toBe(false);
  });

  it("refuses a body that is not an object", async () => {
    installFetchMock(() => ({ status: 200, body: [1, 2, 3] }));
    const store = await loadStore();
    const { AutoReplyStoreResponseError } = await loadErrors();

    await expect(store.readSettings()).rejects.toBeInstanceOf(AutoReplyStoreResponseError);
  });
});


describe("safe recent run adapter", () => {
  it("bounds the list and returns only the operational fields", async () => {
    installFetchMock(() => ({ status: 200, body: [{ runId: "R", trigger: "scheduled", startedAt: "2026-09-14T00:00:00Z", completedAt: null, outcome: null, consideredCount: 0, humanReviewCount: 0, failureCount: 0, sentCount: 0, unexpectedText: "must not escape" }] }));
    const store = await loadStore();
    const rows = await store.listRecentRuns(100);
    expect(rows[0]).toMatchObject({ runId: "R", completedAt: null, sentCount: 0 });
    expect(rows[0]).not.toHaveProperty("unexpectedText");
  });
});


describe("real PostgREST void responses", () => {
  it("accepts empty HTTP 204 for writes without trying to parse JSON", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const store = await loadStore();
    await expect(store.beginRun({ runId: "R", trigger: "scheduled", startedAt: "2026-09-14T00:00:00Z" })).resolves.toBeUndefined();
    await expect(store.endSend({ holder: "H" })).resolves.toBeUndefined();
    await expect(store.finalizeSent({ topLevelCommentId: "C", replyCommentId: "R", resolvedAt: "2026-09-14T00:00:00Z" })).resolves.toBeUndefined();
  });
  it("still rejects an empty response for functions that must return data", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    const store = await loadStore();
    await expect(store.readSettings()).rejects.toThrow();
  });
});
