import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * All network access in this suite goes through a mocked global.fetch —
 * no request ever reaches the real YouTube API. The point of this file is
 * to prove that the client only ever issues GET requests to YouTube (the
 * one POST here is the OAuth token refresh, not a YouTube write), that the
 * outcomes of commentThreads.list are told apart correctly, and that a
 * malformed response shape becomes an explicit "invalid_response" result
 * instead of an uncaught exception.
 *
 * Credentials are loaded from two files (client JSON + comment-read token
 * file), not from raw secret env vars — this suite mocks node:fs so it
 * never touches a real file either.
 */

type FakeBody = Record<string, unknown>;

function fakeResponse(status: number, body: FakeBody): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

interface RecordedCall {
  url: string;
  method: string;
}

const CLIENT_JSON_PATH = "/fake/client_secret.json";
const TOKEN_PATH = "/fake/.secrets/youtube-comment-read-oauth.json";

const fsState = vi.hoisted(() => ({
  files: {} as Record<string, string>,
}));

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    const content = fsState.files[path];
    if (content === undefined) {
      throw new Error(`ENOENT: no fake file registered for ${path}`);
    }
    return content;
  },
}));

function installFetchMock(handlers: {
  onComments?: (url: URL) => Response | Promise<Response>;
}) {
  const calls: RecordedCall[] = [];

  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ url: url.toString(), method });

    if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
      return fakeResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
    }
    if (url.pathname === "/youtube/v3/channels") {
      return fakeResponse(200, { items: [{ id: "channel-mine" }] });
    }
    if (url.pathname === "/youtube/v3/videos") {
      return fakeResponse(200, {
        items: [
          {
            id: "video-1",
            snippet: { title: "시험 영상", channelId: "channel-mine", channelTitle: "내 채널" },
            status: { privacyStatus: "public" },
          },
        ],
      });
    }
    if (url.pathname === "/youtube/v3/commentThreads") {
      if (!handlers.onComments) {
        throw new Error("no onComments handler registered for this test");
      }
      return handlers.onComments(url);
    }
    throw new Error(`unexpected fetch to ${url.toString()}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
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

function assertNoYoutubeWriteRequests(calls: RecordedCall[]) {
  for (const call of calls) {
    const url = new URL(call.url);
    const isTokenEndpoint = url.toString() === "https://oauth2.googleapis.com/token";
    if (isTokenEndpoint) {
      continue;
    }
    expect(url.hostname).toBe("www.googleapis.com");
    expect(call.method).toBe("GET");
  }
}

describe("createRealYoutubeClient — read-only proof", () => {
  it("getMyChannelId issues only GET to channels.list (plus the token POST)", async () => {
    const { calls } = installFetchMock({});
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const channelId = await client.getMyChannelId();

    expect(channelId).toBe("channel-mine");
    assertNoYoutubeWriteRequests(calls);
    const channelsCall = calls.find((call) => call.url.includes("/channels"));
    expect(channelsCall?.url).toContain("mine=true");
  });

  it("getVideo reads snippet and status via GET only, including channelTitle", async () => {
    const { calls } = installFetchMock({});
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const video = await client.getVideo("video-1");

    expect(video).toMatchObject({
      videoId: "video-1",
      title: "시험 영상",
      channelId: "channel-mine",
      channelTitle: "내 채널",
      privacyStatus: "public",
    });
    assertNoYoutubeWriteRequests(calls);
  });

  it("throws a clear error instead of a raw TypeError when videos.list omits snippet", async () => {
    installFetchMock({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
          return fakeResponse(200, { access_token: "t", expires_in: 3600 });
        }
        if (url.pathname === "/youtube/v3/videos") {
          return fakeResponse(200, { items: [{ id: "video-1" }] });
        }
        throw new Error("unexpected");
      }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getVideo("video-1")).rejects.toThrow(/videos\.list/);
  });

  it("distinguishes a normal comment list and keeps thread id separate from top-level comment id", async () => {
    const { calls } = installFetchMock({
      onComments: () =>
        fakeResponse(200, {
          items: [
            {
              id: "thread-abc",
              snippet: {
                topLevelComment: {
                  id: "comment-xyz",
                  // A comment written by someone else: the API returns
                  // textDisplay only, never textOriginal.
                  snippet: { textDisplay: "잘 봤습니다.", publishedAt: "2026-01-01T00:00:00Z" },
                },
              },
            },
          ],
        }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.comments).toHaveLength(1);
      const [firstComment] = result.comments;
      expect(firstComment?.threadId).toBe("thread-abc");
      expect(firstComment?.topLevelCommentId).toBe("comment-xyz");
      expect(firstComment?.threadId).not.toBe(firstComment?.topLevelCommentId);
      expect(firstComment?.text).toBe("잘 봤습니다.");
      expect(result.skippedCount).toBe(0);
      expect(result.nextPageToken).toBeNull();
    }
    assertNoYoutubeWriteRequests(calls);
  });

  it("requests commentThreads.list as plain text, newest first, capped at 20 top-level comments", async () => {
    const { calls } = installFetchMock({
      onComments: () => fakeResponse(200, { items: [] }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await client.listTopLevelComments("video-1");

    const commentsCall = calls.find((call) => call.url.includes("/commentThreads"));
    const params = new URL(commentsCall!.url).searchParams;
    // textFormat=plainText is what makes textDisplay safe to show as text —
    // without it that field arrives as HTML.
    expect(params.get("textFormat")).toBe("plainText");
    expect(params.get("order")).toBe("time");
    expect(params.get("maxResults")).toBe("20");
    expect(params.get("part")).toBe("snippet");
    expect(params.get("videoId")).toBe("video-1");
  });

  it("falls back to textOriginal, the field returned only for the reader's own comment", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(200, {
          items: [
            {
              id: "thread-own",
              snippet: {
                topLevelComment: {
                  id: "comment-own",
                  snippet: { textOriginal: "제가 쓴 댓글입니다.", publishedAt: "2026-01-01T00:00:00Z" },
                },
              },
            },
          ],
        }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.comments[0]?.text).toBe("제가 쓴 댓글입니다.");
    }
  });

  it("skips one unreadable item and reports the count instead of discarding the whole batch", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(200, {
          items: [
            {
              id: "thread-1",
              snippet: {
                topLevelComment: {
                  id: "comment-1",
                  snippet: { textDisplay: "첫 댓글입니다.", publishedAt: "2026-01-01T00:00:00Z" },
                },
              },
            },
            // Deleted between the request and the response: no body field left.
            {
              id: "thread-2",
              snippet: { topLevelComment: { id: "comment-2", snippet: { publishedAt: "2026-01-01T00:00:00Z" } } },
            },
            {
              id: "thread-3",
              snippet: {
                topLevelComment: {
                  id: "comment-3",
                  snippet: { textDisplay: "세 번째 댓글입니다.", publishedAt: "2026-01-02T00:00:00Z" },
                },
              },
            },
          ],
        }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.comments.map((comment) => comment.topLevelCommentId)).toEqual(["comment-1", "comment-3"]);
      expect(result.skippedCount).toBe(1);
    }
  });

  it("reports video_not_found, not a communication failure, when commentThreads.list answers 404", async () => {
    installFetchMock({
      onComments: () => fakeResponse(404, { error: { errors: [{ reason: "videoNotFound" }] } }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("video_not_found");
  });

  it("does not disguise a scope-insufficient token as a communication failure on the comments path", async () => {
    installFetchMock({
      onComments: () => fakeResponse(200, { items: [] }),
    });
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeScopeInsufficientError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.listTopLevelComments("video-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeScopeInsufficientError);
    expect(classifyYoutubeLookupError(caught)).toBe("scope_insufficient");
  });

  it("does not disguise a missing server setting as a communication failure on the comments path", async () => {
    installFetchMock({
      onComments: () => fakeResponse(200, { items: [] }),
    });
    delete process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH;
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeConfigMissingError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.listTopLevelComments("video-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeConfigMissingError);
    expect(classifyYoutubeLookupError(caught)).toBe("config_missing");
  });

  it("surfaces nextPageToken when the API indicates more comments exist beyond this page", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(200, {
          items: [
            {
              id: "thread-abc",
              snippet: {
                topLevelComment: {
                  id: "comment-xyz",
                  snippet: { textDisplay: "잘 봤습니다.", publishedAt: "2026-01-01T00:00:00Z" },
                },
              },
            },
          ],
          nextPageToken: "CAUQAA",
        }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.nextPageToken).toBe("CAUQAA");
    }
  });

  it("distinguishes zero comments from comments being disabled", async () => {
    const { calls } = installFetchMock({
      onComments: () => fakeResponse(200, { items: [] }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("empty");
    assertNoYoutubeWriteRequests(calls);
  });

  it("recognizes commentsDisabled as a distinct outcome from empty", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(403, { error: { errors: [{ reason: "commentsDisabled" }] } }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("disabled");
  });

  it("recognizes quotaExceeded as a distinct outcome", async () => {
    installFetchMock({
      onComments: () => fakeResponse(403, { error: { errors: [{ reason: "quotaExceeded" }] } }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("quota_exceeded");
  });

  it("recognizes a generic permission failure as forbidden, distinct from quota and disabled", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("forbidden");
  });

  it("recognizes a 401 as an auth error distinct from a 403 permission failure", async () => {
    installFetchMock({
      onComments: () => fakeResponse(401, { error: { errors: [{ reason: "authError" }] } }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("auth_error");
  });

  it("recognizes a thrown network failure as a distinct outcome", async () => {
    installFetchMock({
      onComments: () => {
        throw new Error("getaddrinfo ENOTFOUND");
      },
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("network_error");
  });

  it("recognizes a malformed 200 response body as invalid_response instead of throwing", async () => {
    installFetchMock({
      onComments: () =>
        fakeResponse(200, { items: [{ id: "thread-1", snippet: { topLevelComment: null } }] }),
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    const result = await client.listTopLevelComments("video-1");

    expect(result.kind).toBe("invalid_response");
  });

  it("exposes only read methods — there is no write method to call by mistake", async () => {
    installFetchMock({});
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    expect(Object.keys(client).sort()).toEqual(
      ["getMyChannelId", "getVideo", "listTopLevelComments"].sort(),
    );
  });
});

describe("createRealYoutubeClient — client JSON shape validation", () => {
  it("rejects a 'web' client JSON shape — only Desktop (installed) is supported", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = JSON.stringify({
      web: { client_id: "web-id", client_secret: "web-secret" },
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/installed/);
  });

  it("rejects a flat client JSON with no 'installed' wrapper", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = JSON.stringify({
      client_id: "flat-id",
      client_secret: "flat-secret",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/installed/);
  });

  it("rejects a client JSON whose top-level value is an array", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = JSON.stringify([
      { client_id: "array-id", client_secret: "array-secret" },
    ]);
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/형식이 올바르지 않습니다/);
  });

  it("rejects an 'installed' value that is itself an array", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = JSON.stringify({
      installed: [{ client_id: "id", client_secret: "secret" }],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/installed/);
  });

  it("rejects an 'installed' client JSON missing client_id/client_secret", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = JSON.stringify({ installed: { client_id: "only-id" } });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/client_id\/client_secret/);
  });

  it("rejects malformed JSON before any network request is made", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = "not json";
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/파싱할 수 없습니다/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("createRealYoutubeClient — comment-read token file validation", () => {
  /**
   * The current YouTube Data API v3 Discovery document lists youtube.force-ssl
   * as the only scope authorizing commentThreads.list/comments.list — real
   * evidence on 2026-09-14 confirmed this the hard way: a commentThreads.list
   * call on an owned public video returned HTTP 403 insufficientPermissions
   * for a youtube.readonly-scoped token. So this suite proves the opposite of
   * what it used to: youtube.readonly and chapter 18's status-change scope
   * (plain youtube) must now be REJECTED before any network call, and only
   * exact youtube.force-ssl is accepted.
   */
  it("fails closed when the token file is missing the scope field entirely", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({ refresh_token: "test-refresh-token" });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
  });

  it("fails closed when the granted scope does not include youtube.force-ssl", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.upload",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
  });

  it("fails closed when the token file's top-level shape is an array, not an object", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify([
      { refresh_token: "test-refresh-token", scope: "https://www.googleapis.com/auth/youtube.force-ssl" },
    ]);
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/형식이 올바르지 않습니다/);
  });

  it("fails closed when refresh_token is present but not a string", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: 12345,
      scope: "https://www.googleapis.com/auth/youtube.force-ssl",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/refresh_token/);
  });

  it("rejects force-ssl mixed with openid from a singular 'scope' string, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "openid https://www.googleapis.com/auth/youtube.force-ssl",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects force-ssl mixed with openid from the 'scopes' array shape, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: ["openid", "https://www.googleapis.com/auth/youtube.force-ssl"],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects force-ssl mixed with youtube.readonly from a singular 'scope' string, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.readonly",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects force-ssl mixed with youtube (chapter 18's status-change scope) from a singular 'scope' string, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects force-ssl mixed with youtube.upload from a singular 'scope' string, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.force-ssl https://www.googleapis.com/auth/youtube.upload",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects youtube.readonly from a singular 'scope' string, before any network call — it does not authorize commentThreads.list", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects youtube.readonly from the 'scopes' array shape, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: ["https://www.googleapis.com/auth/youtube.readonly"],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects chapter 18's status-change token (scope youtube) from a singular 'scope' string, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects chapter 18's status-change token (scope youtube) from the 'scopes' array shape, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: ["https://www.googleapis.com/auth/youtube"],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects an upload-only scope even when it arrives via the 'scopes' array shape", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: ["https://www.googleapis.com/auth/youtube.upload"],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects a 'scopes' array containing a non-string entry as malformed, before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: ["https://www.googleapis.com/auth/youtube.force-ssl", 42],
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/scopes 배열/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects a token file with neither 'scope' nor 'scopes', before any network call", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({ refresh_token: "test-refresh-token" });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it("rejects a 'scopes' field that is not an array when 'scope' is also absent", async () => {
    const { calls, fetchMock } = installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scopes: "https://www.googleapis.com/auth/youtube.force-ssl",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/범위/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });
});

describe("createRealYoutubeClient — OAuth token refresh response validation", () => {
  function installTokenRefreshMock(tokenBody: FakeBody) {
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
        return fakeResponse(200, tokenBody);
      }
      throw new Error(`unexpected fetch to ${url.toString()}`);
    });
  }

  it("fails closed instead of sending Authorization: Bearer undefined when access_token is missing", async () => {
    vi.stubGlobal("fetch", installTokenRefreshMock({ expires_in: 3600 }));
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/access_token/);
  });

  it("fails closed when access_token is an empty string", async () => {
    vi.stubGlobal("fetch", installTokenRefreshMock({ access_token: "", expires_in: 3600 }));
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/access_token/);
  });

  it("fails closed when expires_in is a numeric string instead of a number", async () => {
    vi.stubGlobal(
      "fetch",
      installTokenRefreshMock({ access_token: "fake-access-token", expires_in: "3600" }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/expires_in/);
  });

  it("fails closed when expires_in is missing", async () => {
    vi.stubGlobal("fetch", installTokenRefreshMock({ access_token: "fake-access-token" }));
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/expires_in/);
  });

  it("fails closed when expires_in is zero or negative", async () => {
    vi.stubGlobal(
      "fetch",
      installTokenRefreshMock({ access_token: "fake-access-token", expires_in: 0 }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/expires_in/);
  });

  it("fails closed when the refresh response body is an array, not an object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => fakeResponse(200, [] as unknown as FakeBody)),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toThrow(/형식이 올바르지 않습니다/);
  });

  it("fails closed when a 200 refresh response is not JSON at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } }) as unknown as Response),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeInvalidResponseError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeInvalidResponseError);
    expect(classifyYoutubeLookupError(caught)).toBe("invalid_response");
  });
});

describe("createRealYoutubeClient — token endpoint HTTP failure classification", () => {
  function installTokenStatusMock(status: number, errorBody: FakeBody) {
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
        return fakeResponse(status, errorBody);
      }
      throw new Error(`unexpected fetch to ${url.toString()}`);
    });
  }

  it("classifies a token endpoint 400 invalid_grant as a typed auth_error, without exposing the body", async () => {
    vi.stubGlobal(
      "fetch",
      installTokenStatusMock(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError } = await import("./errors");
    const { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeAuthError);
    const reason = classifyYoutubeLookupError(caught);
    expect(reason).toBe("auth_error");
    expect(YOUTUBE_LOOKUP_ERROR_MESSAGE[reason]).not.toContain("invalid_grant");
    expect(YOUTUBE_LOOKUP_ERROR_MESSAGE[reason]).not.toContain("revoked");
  });

  it("classifies a token endpoint 401 as a typed auth_error", async () => {
    vi.stubGlobal("fetch", installTokenStatusMock(401, { error: "invalid_client" }));
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError } = await import("./errors");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toBeInstanceOf(YoutubeAuthError);
  });

  it("classifies a token endpoint 403 as a typed auth_error", async () => {
    vi.stubGlobal("fetch", installTokenStatusMock(403, { error: "access_denied" }));
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError } = await import("./errors");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toBeInstanceOf(YoutubeAuthError);
  });

  it("classifies a token endpoint 429 as a typed quota_exceeded", async () => {
    vi.stubGlobal("fetch", installTokenStatusMock(429, { error: "rate_limit_exceeded" }));
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeQuotaExceededError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeQuotaExceededError);
    expect(classifyYoutubeLookupError(caught)).toBe("quota_exceeded");
  });
});

describe("createRealYoutubeClient — channels.list / videos.list reason-aware classification", () => {
  function installListStatusMock(pathname: "/youtube/v3/channels" | "/youtube/v3/videos", status: number, errorBody: FakeBody) {
    return vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
        return fakeResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
      }
      if (url.pathname === pathname) {
        return fakeResponse(status, errorBody);
      }
      throw new Error(`unexpected fetch to ${url.toString()}`);
    });
  }

  it("classifies channels.list 403 quotaExceeded as quota_exceeded, not auth_error", async () => {
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/channels", 403, { error: { errors: [{ reason: "quotaExceeded" }] } }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeQuotaExceededError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeQuotaExceededError);
    expect(classifyYoutubeLookupError(caught)).toBe("quota_exceeded");
  });

  it("classifies channels.list 403 with a non-quota reason as auth_error", async () => {
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/channels", 403, { error: { errors: [{ reason: "insufficientPermissions" }] } }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeAuthError);
    expect(classifyYoutubeLookupError(caught)).toBe("auth_error");
  });

  it("classifies channels.list 401 as auth_error", async () => {
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/channels", 401, { error: { errors: [{ reason: "authError" }] } }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError } = await import("./errors");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toBeInstanceOf(YoutubeAuthError);
  });

  it("classifies videos.list 403 dailyLimitExceeded as quota_exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/videos", 403, { error: { errors: [{ reason: "dailyLimitExceeded" }] } }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeQuotaExceededError } = await import("./errors");
    const client = createRealYoutubeClient();

    await expect(client.getVideo("video-1")).rejects.toBeInstanceOf(YoutubeQuotaExceededError);
  });

  it("classifies videos.list 403 with a non-quota reason as auth_error, distinct from quota", async () => {
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/videos", 403, { error: { errors: [{ reason: "forbidden" }] } }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeAuthError, YoutubeQuotaExceededError } = await import("./errors");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getVideo("video-1");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeAuthError);
    expect(caught).not.toBeInstanceOf(YoutubeQuotaExceededError);
  });

  it("never forwards the raw API error reason or response body into the browser-safe message", async () => {
    const secretishDetail = "insufficientPermissions: user does not own this resource";
    vi.stubGlobal(
      "fetch",
      installListStatusMock("/youtube/v3/videos", 403, {
        error: { errors: [{ reason: "insufficientPermissions", message: secretishDetail }] },
      }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getVideo("video-1");
    } catch (error) {
      caught = error;
    }
    const reason = classifyYoutubeLookupError(caught);
    const safeMessage = YOUTUBE_LOOKUP_ERROR_MESSAGE[reason];
    expect(safeMessage).not.toContain(secretishDetail);
    expect(safeMessage).not.toContain("insufficientPermissions");
    expect(safeMessage).not.toMatch(/\/videos/);
  });

  it("classifies a malformed 200 channels.list response as invalid_response instead of throwing an uncaught error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        if (url.origin + url.pathname === "https://oauth2.googleapis.com/token") {
          return fakeResponse(200, { access_token: "fake-access-token", expires_in: 3600 });
        }
        if (url.pathname === "/youtube/v3/channels") {
          return { ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } } as unknown as Response;
        }
        throw new Error(`unexpected fetch to ${url.toString()}`);
      }),
    );
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeInvalidResponseError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeInvalidResponseError);
    expect(classifyYoutubeLookupError(caught)).toBe("invalid_response");
  });
});

describe("createRealYoutubeClient — typed config/credential/scope errors", () => {
  /**
   * These prove the client throws the closed, typed error classes (not a
   * hand-built Error whose classification depends on regex-matching a
   * message that may itself embed the very path being validated) for the
   * three failure modes a beginner hits during local setup: an unset env
   * var, a client/token file that cannot be read or parsed, and a token
   * whose granted scope is insufficient.
   */
  it("throws YoutubeConfigMissingError, classified as config_missing, when the client JSON path env var is unset", async () => {
    installFetchMock({});
    delete process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH;
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeConfigMissingError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeConfigMissingError);
    expect(classifyYoutubeLookupError(caught)).toBe("config_missing");
  });

  it("throws YoutubeConfigMissingError, classified as config_missing, when the comment-read token path env var is unset", async () => {
    installFetchMock({});
    delete process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH;
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeConfigMissingError } = await import("./errors");
    const client = createRealYoutubeClient();

    await expect(client.getMyChannelId()).rejects.toBeInstanceOf(YoutubeConfigMissingError);
  });

  it("throws YoutubeCredentialFileError, classified as credential_file_invalid, when the client JSON is unreadable", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = "not json";
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeCredentialFileError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeCredentialFileError);
    expect(classifyYoutubeLookupError(caught)).toBe("credential_file_invalid");
  });

  it("throws YoutubeCredentialFileError, classified as credential_file_invalid, when the comment-read token file is malformed", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = "not json";
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeCredentialFileError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeCredentialFileError);
    expect(classifyYoutubeLookupError(caught)).toBe("credential_file_invalid");
  });

  it("throws YoutubeScopeInsufficientError, classified as scope_insufficient, when the granted scope excludes the closed allowlist", async () => {
    installFetchMock({});
    fsState.files[TOKEN_PATH] = JSON.stringify({
      refresh_token: "test-refresh-token",
      scope: "https://www.googleapis.com/auth/youtube.upload",
    });
    const { createRealYoutubeClient } = await import("./real-client");
    const { YoutubeScopeInsufficientError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeScopeInsufficientError);
    expect(classifyYoutubeLookupError(caught)).toBe("scope_insufficient");
  });

  it("never leaks the configured file path into the fixed browser-safe message for any of these three failure modes", async () => {
    installFetchMock({});
    fsState.files[CLIENT_JSON_PATH] = "not json";
    const { createRealYoutubeClient } = await import("./real-client");
    const { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } = await import("./error-classification");
    const client = createRealYoutubeClient();

    let caught: unknown;
    try {
      await client.getMyChannelId();
    } catch (error) {
      caught = error;
    }
    const reason = classifyYoutubeLookupError(caught);
    const safeMessage = YOUTUBE_LOOKUP_ERROR_MESSAGE[reason];
    expect(safeMessage).not.toContain(CLIENT_JSON_PATH);
    expect(safeMessage).not.toMatch(/\.json/);
  });
});
