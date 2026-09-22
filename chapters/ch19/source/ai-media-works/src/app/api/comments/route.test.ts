import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentsListResult, VideoLookup, YoutubeClient } from "@/lib/youtube/types";
import { YoutubeCredentialFileError, YoutubeScopeInsufficientError } from "@/lib/youtube/errors";

const state = vi.hoisted(() => ({ client: null as YoutubeClient | null }));

vi.mock("@/lib/youtube/real-client", () => ({
  createRealYoutubeClient: () => {
    if (!state.client) throw new Error("test did not set state.client");
    return state.client;
  },
}));

const { POST } = await import("./route");

function makeClient(video: VideoLookup, listResult: CommentsListResult, myChannelId = video.channelId): YoutubeClient {
  return {
    getMyChannelId: async () => myChannelId,
    getVideo: async () => video,
    listTopLevelComments: async () => listResult,
  };
}

const OWNED_VIDEO: VideoLookup = {
  videoId: "video-1",
  title: "시험 영상",
  channelId: "channel-mine",
  channelTitle: "내 채널",
  privacyStatus: "public",
  commentsEnabledHint: null,
};

function request(body: unknown) {
  return new Request("http://localhost/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.client = null;
});

describe("POST /api/comments", () => {
  it("refuses to list comments for a video the connected channel does not own", async () => {
    state.client = makeClient(OWNED_VIDEO, { kind: "empty" }, "someone-elses-channel");

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reason).toBe("channel_mismatch");
  });

  it("returns comments with distinct thread and top-level comment IDs, capped note included", async () => {
    state.client = makeClient(OWNED_VIDEO, {
      kind: "ok",
      comments: [
        { threadId: "thread-1", topLevelCommentId: "comment-1", text: "잘 봤습니다.", publishedAt: "2026-01-01T00:00:00Z" },
      ],
      skippedCount: 0,
      nextPageToken: null,
    });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.comments).toHaveLength(1);
    expect(body.count).toBe(1);
    expect(body.skippedCount).toBe(0);
    expect(body.isPartial).toBe(false);
    expect(body.fetchedAt).toBeTruthy();
    expect(body.note).toMatch(/최대 20개/);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
  });

  it("marks the result as partial when the API reports more comments beyond this page", async () => {
    state.client = makeClient(OWNED_VIDEO, {
      kind: "ok",
      comments: [
        { threadId: "thread-1", topLevelCommentId: "comment-1", text: "잘 봤습니다.", publishedAt: "2026-01-01T00:00:00Z" },
      ],
      skippedCount: 0,
      nextPageToken: "CAUQAA",
    });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(body.isPartial).toBe(true);
  });

  it("discloses how many returned items could not be read instead of silently shortening the list", async () => {
    state.client = makeClient(OWNED_VIDEO, {
      kind: "ok",
      comments: [
        { threadId: "thread-1", topLevelCommentId: "comment-1", text: "잘 봤습니다.", publishedAt: "2026-01-01T00:00:00Z" },
      ],
      skippedCount: 2,
      nextPageToken: null,
    });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.count).toBe(1);
    expect(body.skippedCount).toBe(2);
  });

  it("reports a video that is gone as video_not_found, not as a communication failure", async () => {
    state.client = makeClient(OWNED_VIDEO, { kind: "video_not_found" });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.reason).toBe("video_not_found");
    expect(body.message).not.toMatch(/인터넷 연결/);
  });

  it("classifies a setup error thrown by the comments call itself, instead of a blanket unexpected_error", async () => {
    const secretPath = "/Users/someone/.secrets/youtube-comment-read-oauth.json";
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => OWNED_VIDEO,
      listTopLevelComments: async () => {
        throw new YoutubeScopeInsufficientError(`token at ${secretPath} lacks scope`);
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("scope_insufficient");
    expect(JSON.stringify(body)).not.toContain(secretPath);
  });

  it("blocks a private video before commentThreads.list is ever called", async () => {
    let listCalled = false;
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => ({ ...OWNED_VIDEO, privacyStatus: "private" }),
      listTopLevelComments: async () => {
        listCalled = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.reason).toBe("privacy_blocked");
    expect(body.message).toMatch(/다른/);
    expect(listCalled).toBe(false);
  });

  it("blocks an unrecognized privacy value before commentThreads.list is ever called", async () => {
    let listCalled = false;
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => ({ ...OWNED_VIDEO, privacyStatus: "somethingUnknown" }),
      listTopLevelComments: async () => {
        listCalled = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({ videoId: "video-1" }));

    expect(response.status).toBe(403);
    expect(listCalled).toBe(false);
  });

  it("allows an unlisted video to proceed to commentThreads.list", async () => {
    state.client = makeClient(
      { ...OWNED_VIDEO, privacyStatus: "unlisted" },
      { kind: "empty" },
    );

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reason).toBe("empty");
  });

  it("distinguishes an empty list from comments being disabled", async () => {
    state.client = makeClient(OWNED_VIDEO, { kind: "empty" });
    const emptyResponse = await POST(request({ videoId: "video-1" }));
    const emptyBody = await emptyResponse.json();
    expect(emptyBody.reason).toBe("empty");
    expect(emptyBody.comments).toEqual([]);

    state.client = makeClient(OWNED_VIDEO, { kind: "disabled" });
    const disabledResponse = await POST(request({ videoId: "video-1" }));
    const disabledBody = await disabledResponse.json();
    expect(disabledBody.reason).toBe("comments_disabled");
  });

  it("distinguishes forbidden, auth, quota, invalid-response, and network failure", async () => {
    state.client = makeClient(OWNED_VIDEO, { kind: "forbidden" });
    const forbidden = await POST(request({ videoId: "video-1" }));
    expect(forbidden.status).toBe(403);

    state.client = makeClient(OWNED_VIDEO, { kind: "auth_error" });
    const auth = await POST(request({ videoId: "video-1" }));
    expect(auth.status).toBe(401);

    state.client = makeClient(OWNED_VIDEO, { kind: "quota_exceeded" });
    const quota = await POST(request({ videoId: "video-1" }));
    expect(quota.status).toBe(429);

    state.client = makeClient(OWNED_VIDEO, { kind: "invalid_response", message: "shape" });
    const invalid = await POST(request({ videoId: "video-1" }));
    expect(invalid.status).toBe(502);

    state.client = makeClient(OWNED_VIDEO, { kind: "network_error", message: "boom" });
    const network = await POST(request({ videoId: "video-1" }));
    expect(network.status).toBe(502);
  });

  it("returns a safe 500 instead of a raw exception when listTopLevelComments throws unexpectedly", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => OWNED_VIDEO,
      listTopLevelComments: async () => {
        throw new Error("boom from deep inside the client");
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toMatch(/boom from deep inside/);
  });

  it("returns a safe classified reason with no raw error detail when the ownership check itself throws", async () => {
    let listCalled = false;
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => {
        throw new Error("videos.list failed with status 401 while reading /Users/someone/.secrets/token.json");
      },
      listTopLevelComments: async () => {
        listCalled = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.status).toBe("error");
    expect(body.reason).toBe("ownership_auth_error");
    expect(body).not.toHaveProperty("detail");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("/Users/someone/.secrets/token.json");
    expect(serialized).not.toMatch(/videos\.list failed/);
    expect(listCalled).toBe(false);
  });

  it("classifies a typed credential file error during ownership check as ownership_credential_file_invalid, without leaking the path", async () => {
    const secretPath = "/Users/someone/.secrets/client_secret.json";
    let listCalled = false;
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => {
        throw new YoutubeCredentialFileError(`cannot parse ${secretPath}`);
      },
      listTopLevelComments: async () => {
        listCalled = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("ownership_credential_file_invalid");
    expect(JSON.stringify(body)).not.toContain(secretPath);
    expect(listCalled).toBe(false);
  });

  it("classifies a typed scope-insufficient error during ownership check as ownership_scope_insufficient", async () => {
    let listCalled = false;
    state.client = {
      getMyChannelId: async () => {
        throw new YoutubeScopeInsufficientError("token at /Users/someone/.secrets/token.json lacks scope");
      },
      getVideo: async () => OWNED_VIDEO,
      listTopLevelComments: async () => {
        listCalled = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("ownership_scope_insufficient");
    expect(JSON.stringify(body)).not.toContain("/Users/someone/.secrets/token.json");
    expect(listCalled).toBe(false);
  });

  it("never forwards the raw invalid_response client message to the browser", async () => {
    state.client = makeClient(OWNED_VIDEO, {
      kind: "invalid_response",
      message: "commentThreads.list 응답을 읽지 못했습니다: /Users/someone/.secrets/token.json 에서 파싱 실패",
    });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("invalid_response");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("/Users/someone/.secrets/token.json");
    expect(serialized).not.toMatch(/파싱 실패/);
  });

  it("never forwards the raw network_error client message to the browser", async () => {
    state.client = makeClient(OWNED_VIDEO, {
      kind: "network_error",
      message: "getaddrinfo ENOTFOUND internal-proxy.corp.example at /Users/someone/app/src/lib/youtube/real-client.ts:200",
    });

    const response = await POST(request({ videoId: "video-1" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("network_error");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("internal-proxy.corp.example");
    expect(serialized).not.toContain("/Users/someone/app/src/lib/youtube/real-client.ts");
    expect(serialized).not.toMatch(/ENOTFOUND/);
  });

  it("rejects a request without a videoId without calling the YouTube client", async () => {
    let calledList = false;
    state.client = {
      getMyChannelId: async () => "x",
      getVideo: async () => OWNED_VIDEO,
      listTopLevelComments: async () => {
        calledList = true;
        return { kind: "empty" };
      },
    };

    const response = await POST(request({}));

    expect(response.status).toBe(400);
    expect(calledList).toBe(false);
  });
});
