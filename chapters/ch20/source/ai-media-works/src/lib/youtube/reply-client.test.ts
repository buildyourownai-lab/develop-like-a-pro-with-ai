import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The write client, exercised entirely against a mocked global.fetch. Nothing
 * in this file reaches YouTube, which matters more here than anywhere else in
 * the project: a real call would post a reply on a real person's video.
 *
 * What this suite is really about is the line between "definitely not sent" and
 * "might have been sent". Everything that could possibly have created a reply
 * has to come back as result_unknown, because the caller refunds a daily slot
 * and moves on for the first kind, and halts for the second.
 */

type FakeBody = Record<string, unknown>;

function fakeResponse(status: number, body: FakeBody): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function unreadableResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("본문을 읽을 수 없습니다");
    },
  } as unknown as Response;
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

const CLIENT_JSON_PATH = "/fake/client_secret.json";
const TOKEN_PATH = "/fake/.secrets/youtube-comment-oauth.json";

const fsState = vi.hoisted(() => ({ files: {} as Record<string, string> }));

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    const content = fsState.files[path];
    if (content === undefined) {
      throw new Error(`ENOENT: no fake file registered for ${path}`);
    }
    return content;
  },
}));

function installFetchMock(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({
      url: url.toString(),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : null,
    });
    if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
      return fakeResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
    }
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls };
}

beforeEach(() => {
  vi.resetModules();
  process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH = CLIENT_JSON_PATH;
  process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
  fsState.files = {
    [CLIENT_JSON_PATH]: JSON.stringify({
      installed: { client_id: "test-client-id", client_secret: "test-client-secret" },
    }),
    [TOKEN_PATH]: JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    }),
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function loadClient() {
  const { createRealReplyClient } = await import("./reply-client");
  return createRealReplyClient();
}

describe("insertReply — the one write call", () => {
  it("POSTs a reply to comments.insert with the parent id and text in the body, and the token in a header", async () => {
    const { calls } = installFetchMock((url) => {
      expect(url.pathname).toBe("/youtube/v3/comments");
      return fakeResponse(200, { id: "reply-1" });
    });
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    expect(result).toEqual({ kind: "ok", replyCommentId: "reply-1" });
    const write = calls.find((call) => call.url.includes("/youtube/v3/comments"));
    expect(write?.method).toBe("POST");
    expect(write?.url).toContain("part=snippet");
    // The access token is in the header, never in the query string.
    expect(write?.url).not.toContain("fake-access-token");
    expect(write?.headers.Authorization).toBe("Bearer fake-access-token");
    expect(JSON.parse(write?.body ?? "{}")).toEqual({
      snippet: { parentId: "comment-1", textOriginal: "감사합니다." },
    });
  });

  it("treats a broken connection as result_unknown, because the request may have arrived", async () => {
    installFetchMock(() => {
      throw new Error("socket hang up");
    });
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    expect(result).toEqual({ kind: "result_unknown", reason: "connection_interrupted" });
  });

  it("treats HTTP 408 and abort timeout as unknown, with a bounded POST", async () => {
    installFetchMock((_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return fakeResponse(408, {});
    });
    const client = await loadClient();
    expect((await client.insertReply({ parentCommentId: "C", text: "감사합니다." })).kind).toBe("result_unknown");
    installFetchMock(() => { throw new DOMException("timed out", "TimeoutError"); });
    expect((await client.insertReply({ parentCommentId: "C", text: "감사합니다." })).kind).toBe("result_unknown");
  });

  it("treats a 500 as result_unknown, because YouTube may have applied the insert before failing to answer", async () => {
    installFetchMock(() => fakeResponse(500, { error: { errors: [{ reason: "backendError" }] } }));
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    expect(result).toEqual({ kind: "result_unknown", reason: "server_error" });
  });

  it("treats an unreadable 200 as result_unknown rather than as a failure", async () => {
    installFetchMock(() => unreadableResponse(200));
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    // Calling this a failure would refund the slot and let the next run send a
    // second reply to the same comment.
    expect(result).toEqual({ kind: "result_unknown", reason: "unreadable_success_response" });
  });

  it("treats a 200 with no id as result_unknown", async () => {
    installFetchMock(() => fakeResponse(200, { snippet: {} }));
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    expect(result).toEqual({ kind: "result_unknown", reason: "unreadable_success_response" });
  });

  it("reports the refusals that provably created nothing, so the slot can go back", async () => {
    const cases: Array<{ status: number; reason: string | null; expected: string }> = [
      { status: 403, reason: "quotaExceeded", expected: "quota_exceeded" },
      { status: 401, reason: "authError", expected: "auth_error" },
      { status: 403, reason: "forbidden", expected: "forbidden" },
      { status: 404, reason: "commentNotFound", expected: "parent_not_found" },
      { status: 400, reason: "invalidValue", expected: "invalid_request" },
    ];

    for (const testCase of cases) {
      vi.resetModules();
      installFetchMock(() =>
        fakeResponse(testCase.status, {
          error: { errors: testCase.reason === null ? [] : [{ reason: testCase.reason }] },
        }),
      );
      const client = await loadClient();

      const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

      expect(result).toEqual({ kind: "rejected", reason: testCase.expected });
    }
  });
});

describe("listReplies — the full comments.list walk", () => {
  it("follows every page and returns the replies from all of them", async () => {
    const pages: Record<string, FakeBody> = {
      "": {
        items: [{ id: "r1", snippet: { authorChannelId: { value: "UC_MINE" } } }],
        nextPageToken: "p2",
      },
      p2: {
        items: [{ id: "r2", snippet: { authorChannelId: { value: "UC_OTHER" } } }],
        nextPageToken: "p3",
      },
      p3: {
        items: [{ id: "r3", snippet: { authorChannelId: { value: "UC_MINE" } } }],
      },
    };
    const { calls } = installFetchMock((url) => {
      const token = url.searchParams.get("pageToken") ?? "";
      expect(url.searchParams.get("parentId")).toBe("comment-1");
      expect(url.searchParams.get("maxResults")).toBe("100");
      return fakeResponse(200, pages[token] ?? {});
    });
    const client = await loadClient();

    const result = await client.listReplies("comment-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.pageCount).toBe(3);
      expect(result.replies.map((reply) => reply.replyCommentId)).toEqual(["r1", "r2", "r3"]);
      expect(result.replies[1]?.authorChannelId).toBe("UC_OTHER");
    }
    // Every page was a GET; nothing about reading replies writes anything.
    const listCalls = calls.filter((call) => call.url.includes("/youtube/v3/comments"));
    expect(listCalls).toHaveLength(3);
    expect(listCalls.every((call) => call.method === "GET")).toBe(true);
  });

  it("reads authorChannelId out of its object shape and yields null for anything unexpected", async () => {
    installFetchMock(() =>
      fakeResponse(200, {
        items: [
          { id: "r1", snippet: { authorChannelId: { value: "UC_MINE" } } },
          { id: "r2", snippet: { authorChannelId: "UC_MINE" } },
          { id: "r3", snippet: {} },
          { id: "r4" },
        ],
      }),
    );
    const client = await loadClient();

    const result = await client.listReplies("comment-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.replies.map((reply) => reply.authorChannelId)).toEqual([
        "UC_MINE",
        // A bare string is not the documented shape, so it is not trusted as
        // proof of authorship — "not provably mine" is the safe direction.
        null,
        null,
        null,
      ]);
    }
  });

  it("refuses to call a repeated page token a completed walk", async () => {
    installFetchMock(() =>
      fakeResponse(200, { items: [{ id: "r1", snippet: {} }], nextPageToken: "same" }),
    );
    const client = await loadClient();

    const result = await client.listReplies("comment-1");

    // page_limit_reached, never ok: reporting this as a finished walk with no
    // reply of ours in it is exactly what would cause a duplicate reply.
    expect(result.kind).toBe("page_limit_reached");
  });

  it("reports a mid-walk network failure instead of the pages it already had", async () => {
    let call = 0;
    installFetchMock(() => {
      call += 1;
      if (call === 1) {
        return fakeResponse(200, { items: [{ id: "r1", snippet: {} }], nextPageToken: "p2" });
      }
      throw new Error("connection reset");
    });
    const client = await loadClient();

    const result = await client.listReplies("comment-1");

    expect(result.kind).toBe("network_error");
  });

  it("classifies an auth failure and quota exhaustion separately from a network failure", async () => {
    const cases = [
      { status: 401, reason: "authError", expected: "auth_error" },
      { status: 403, reason: "quotaExceeded", expected: "quota_exceeded" },
      { status: 403, reason: "forbidden", expected: "forbidden" },
      { status: 404, reason: "commentNotFound", expected: "parent_not_found" },
    ];
    for (const testCase of cases) {
      vi.resetModules();
      installFetchMock(() =>
        fakeResponse(testCase.status, { error: { errors: [{ reason: testCase.reason }] } }),
      );
      const client = await loadClient();

      const result = await client.listReplies("comment-1");

      expect(result.kind).toBe(testCase.expected);
    }
  });

  it("reports an unreadable page as invalid_response, not as an empty reply list", async () => {
    installFetchMock(() => fakeResponse(200, { items: "not-a-list" }));
    const client = await loadClient();

    expect((await client.listReplies("comment-1")).kind).toBe("invalid_response");
  });
});

describe("an expired or revoked OAuth token", () => {
  it("reports a failed refresh as definitely-not-sent, and never attempts comments.insert", async () => {
    const attempted: string[] = [];
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      attempted.push(url.pathname);
      if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
        // What Google returns for a revoked or expired refresh token.
        return fakeResponse(400, { error: "invalid_grant" });
      }
      return fakeResponse(200, { id: "reply-1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    // rejected, not result_unknown: the failure happened while getting a
    // token, so nothing was sent and the daily slot can be given back.
    expect(result).toEqual({ kind: "rejected", reason: "credentials_unavailable" });
    expect(attempted).toEqual(["/token"]);
  });

  it("refuses a token file whose scope is not exactly youtube.force-ssl, without calling YouTube", async () => {
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
    const { calls } = installFetchMock(() => fakeResponse(200, { id: "reply-1" }));
    const client = await loadClient();

    const result = await client.insertReply({ parentCommentId: "comment-1", text: "감사합니다." });

    expect(result).toEqual({ kind: "rejected", reason: "credentials_unavailable" });
    expect(calls).toEqual([]);
  });

  it("reports an inconclusive reply walk when credentials are unusable, never an empty list", async () => {
    fsState.files[TOKEN_PATH] = JSON.stringify({ refresh_token: "test-refresh-token", scope: "" });
    installFetchMock(() => fakeResponse(200, { items: [] }));
    const client = await loadClient();

    expect((await client.listReplies("comment-1")).kind).toBe("auth_error");
  });
});


describe("the actual POST date after OAuth refresh", () => {
  it("does not send on a new Seoul day using yesterday's reservation", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T14:59:59.000Z"));
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes("oauth2.googleapis.com")) {
        vi.setSystemTime(new Date("2026-09-14T15:00:01.000Z"));
        return fakeResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
      }
      throw new Error("A YouTube POST must not start");
    }));
    try {
      const client = await loadClient();
      expect(await client.insertReply({ parentCommentId: "C", text: "감사합니다.", expectedSendDay: "2026-09-14" })).toEqual({ kind: "rejected", reason: "send_window_expired" });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toContain("oauth2.googleapis.com");
    } finally { vi.useRealTimers(); }
  });
});
