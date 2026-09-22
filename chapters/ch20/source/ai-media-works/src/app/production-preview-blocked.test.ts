import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRODUCTION_PREVIEW_BLOCKED_MESSAGE } from "@/lib/autoreply/runtime-guard";
import { FakeGeminiClient } from "@/lib/gemini/__fixtures__/fake-client";
import type { GeminiClient } from "@/lib/gemini/types";
import type { VideoLookup, YoutubeClient } from "@/lib/youtube/types";

/**
 * Chapter 19's three routes and its page return other people's comment text and
 * the drafts written from it. On a deployed server that would hand a stranger
 * the channel's inbox, so all four are closed when NODE_ENV is "production".
 *
 * The clients are mocked so that a route which is NOT blocked gets far enough to
 * answer normally — otherwise "not a 404" would prove nothing.
 */

const state = vi.hoisted(() => ({
  youtube: null as YoutubeClient | null,
  gemini: null as GeminiClient | null,
}));

vi.mock("@/lib/youtube/real-client", () => ({
  createRealYoutubeClient: () => {
    if (!state.youtube) throw new Error("test did not set state.youtube");
    return state.youtube;
  },
}));

vi.mock("@/lib/gemini/real-client", () => ({
  createRealGeminiClient: () => {
    if (!state.gemini) throw new Error("test did not set state.gemini");
    return state.gemini;
  },
  hasGeminiConfig: () => true,
}));

const { POST: videoPost } = await import("./api/video/route");
const { POST: commentsPost } = await import("./api/comments/route");
const { POST: reviewPost } = await import("./api/review/route");
const { default: Page } = await import("./page");

const VIDEO: VideoLookup = {
  videoId: "video-1",
  title: "시험 영상",
  channelId: "channel-mine",
  channelTitle: "내 채널",
  privacyStatus: "public",
  commentsEnabledHint: null,
};

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * Written through a cast because some type declarations describe NODE_ENV as a
 * read-only union. The value is restored after every test.
 */
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function post(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ROUTES: Array<{ name: string; call: () => Promise<Response> }> = [
  {
    name: "POST /api/video",
    call: () => videoPost(post("/api/video", { videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })),
  },
  {
    name: "POST /api/comments",
    call: () => commentsPost(post("/api/comments", { videoId: "video-1" })),
  },
  {
    name: "POST /api/review",
    call: () =>
      reviewPost(
        post("/api/review", {
          comments: [
            {
              threadId: "thread-1",
              topLevelCommentId: "comment-1",
              text: "영상 잘 봤습니다.",
              publishedAt: "2026-09-14T00:00:00.000Z",
            },
          ],
        }),
      ),
  },
];

beforeEach(() => {
  state.youtube = {
    getMyChannelId: async () => "channel-mine",
    getVideo: async () => VIDEO,
    listTopLevelComments: async () => ({ kind: "empty" }),
  };
  state.gemini = new FakeGeminiClient({
    classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
    draft: () => ({ draft: "봐 주셔서 감사합니다." }),
    contextCheck: () => ({ passed: true, reason: "문맥에 맞습니다." }),
  });
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
});

describe("in production", () => {
  beforeEach(() => {
    setNodeEnv("production");
  });

  for (const route of ROUTES) {
    it(`closes ${route.name} with a 404 before it looks at the request at all`, async () => {
      const response = await route.call();
      const body = await response.json();

      // 404, not 403: a deployed server does not confirm that a
      // comment-reading endpoint is there.
      expect(response.status).toBe(404);
      expect(body).toEqual({ error: PRODUCTION_PREVIEW_BLOCKED_MESSAGE });
    });
  }

  it("never calls YouTube or Gemini for any of them", async () => {
    let youtubeCalls = 0;
    state.youtube = {
      getMyChannelId: async () => {
        youtubeCalls += 1;
        return "channel-mine";
      },
      getVideo: async () => {
        youtubeCalls += 1;
        return VIDEO;
      },
      listTopLevelComments: async () => {
        youtubeCalls += 1;
        return { kind: "empty" };
      },
    };
    const gemini = new FakeGeminiClient({
      classify: () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: () => ({ draft: "봐 주셔서 감사합니다." }),
      contextCheck: () => ({ passed: true, reason: "문맥에 맞습니다." }),
    });
    state.gemini = gemini;

    for (const route of ROUTES) {
      await route.call();
    }

    expect(youtubeCalls).toBe(0);
    expect(gemini.classifyCalls).toEqual([]);
  });

  it("shows a notice page instead of the reader UI", () => {
    const element = Page();

    // Rendered without a DOM: the element's type tells us which branch ran.
    expect(element.type).toBe("main");
    expect(JSON.stringify(element)).toContain(PRODUCTION_PREVIEW_BLOCKED_MESSAGE);
  });
});

describe("on the reader's own machine", () => {
  beforeEach(() => {
    setNodeEnv("development");
  });

  for (const route of ROUTES) {
    it(`leaves ${route.name} working`, async () => {
      const response = await route.call();

      expect(response.status).not.toBe(404);
      expect(JSON.stringify(await response.json())).not.toContain(PRODUCTION_PREVIEW_BLOCKED_MESSAGE);
    });
  }

  it("renders the reader UI", () => {
    const element = Page();

    expect(element.type).not.toBe("main");
    expect(typeof element.type).toBe("function");
  });
});
