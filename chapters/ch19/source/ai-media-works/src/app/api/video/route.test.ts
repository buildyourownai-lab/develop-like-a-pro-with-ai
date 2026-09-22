import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoLookup, YoutubeClient } from "@/lib/youtube/types";
import { YoutubeCredentialFileError, YoutubeScopeInsufficientError } from "@/lib/youtube/errors";

const state = vi.hoisted(() => ({ client: null as YoutubeClient | null }));

vi.mock("@/lib/youtube/real-client", () => ({
  createRealYoutubeClient: () => {
    if (!state.client) throw new Error("test did not set state.client");
    return state.client;
  },
}));

const { POST } = await import("./route");

function request(body: unknown) {
  return new Request("http://localhost/api/video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VIDEO: VideoLookup = {
  videoId: "video-1",
  title: "시험 영상",
  channelId: "channel-mine",
  channelTitle: "내 채널",
  privacyStatus: "public",
  commentsEnabledHint: null,
};

beforeEach(() => {
  state.client = null;
});

describe("POST /api/video", () => {
  it("rejects a URL it cannot parse a video ID from", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://example.com/nope" }));
    expect(response.status).toBe(400);
  });

  it("confirms a matching channel and does not change any settings", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(body.channelMatches).toBe(true);
    expect(body.title).toBe("시험 영상");
    expect(body.channelTitle).toBe("내 채널");
    expect(body.privacyStatus).toBe("public");
    expect(body.commentReadEligible).toBe(true);
    expect(body.myChannelId).toBe("channel-mine");
  });

  it("flags a private video as not eligible for comment reading", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => ({ ...VIDEO, privacyStatus: "private" }),
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(body.commentReadEligible).toBe(false);
  });

  it("treats an unlisted video as eligible for comment reading", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => ({ ...VIDEO, privacyStatus: "unlisted" }),
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(body.commentReadEligible).toBe(true);
  });

  it("reports a mismatched channel instead of blocking silently", async () => {
    state.client = {
      getMyChannelId: async () => "someone-else",
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(body.channelMatches).toBe(false);
  });

  it("returns a classified status:error (not a status:ok card with a raw message) when the channel lookup fails", async () => {
    state.client = {
      getMyChannelId: async () => {
        throw new Error("channels.list failed with status 500 talking to https://internal.example/secret-path");
      },
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.status).toBe("error");
    expect(body.target).toBe("channel");
    expect(typeof body.reason).toBe("string");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/channels\.list failed/);
    expect(serialized).not.toContain("internal.example/secret-path");
  });

  it("returns a classified status:error when the video lookup fails, without leaking the raw error", async () => {
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => {
        throw new Error("YOUTUBE_OAUTH_CLIENT_JSON_PATH is not set on the server.");
      },
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.status).toBe("error");
    expect(body.target).toBe("video");
    expect(body.reason).toBe("config_missing");
    expect(JSON.stringify(body)).not.toContain("YOUTUBE_OAUTH_CLIENT_JSON_PATH");
  });

  it("classifies a typed credential file error as credential_file_invalid, without leaking the file path", async () => {
    const secretPath = "/Users/someone/.secrets/client_secret.json";
    state.client = {
      getMyChannelId: async () => "channel-mine",
      getVideo: async () => {
        throw new YoutubeCredentialFileError(`cannot parse ${secretPath}`);
      },
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.reason).toBe("credential_file_invalid");
    expect(JSON.stringify(body)).not.toContain(secretPath);
  });

  it("classifies a typed scope-insufficient error as scope_insufficient, without leaking the fixed browser message's underlying detail", async () => {
    state.client = {
      getMyChannelId: async () => {
        throw new YoutubeScopeInsufficientError("token at /Users/someone/.secrets/token.json lacks scope");
      },
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.target).toBe("channel");
    expect(body.reason).toBe("scope_insufficient");
    expect(JSON.stringify(body)).not.toContain("/Users/someone/.secrets/token.json");
  });

  it("tells the reader a wrong or deleted video address apart from a broken response", async () => {
    const { parseVideoLookup } = await import("@/lib/youtube/schema");
    state.client = {
      getMyChannelId: async () => "channel-mine",
      // videos.list answers 200 with an empty items array for an id that does
      // not exist or is not visible to this account.
      getVideo: async () => parseVideoLookup({ items: [] }),
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.target).toBe("video");
    expect(body.reason).toBe("video_not_found");
    expect(body.message).not.toContain("응답 형식");
  });

  it("tells an account with no YouTube channel apart from a broken response", async () => {
    const { parseMyChannelId } = await import("@/lib/youtube/schema");
    state.client = {
      getMyChannelId: async () => parseMyChannelId({ items: [] }),
      getVideo: async () => VIDEO,
      listTopLevelComments: async () => ({ kind: "empty" }),
    };

    const response = await POST(request({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }));
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.target).toBe("channel");
    expect(body.reason).toBe("channel_not_found");
    expect(body.message).not.toContain("응답 형식");
  });
});
