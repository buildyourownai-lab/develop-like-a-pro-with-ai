import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeminiClient } from "@/lib/gemini/types";
import { FakeGeminiClient } from "@/lib/gemini/__fixtures__/fake-client";
import { TEST_COMMENTS } from "@/lib/comments/__fixtures__/test-comments";

const state = vi.hoisted(() => ({ client: null as GeminiClient | null, hasConfig: true }));

vi.mock("@/lib/gemini/real-client", () => ({
  createRealGeminiClient: () => {
    if (!state.client) throw new Error("test did not set state.client");
    return state.client;
  },
  hasGeminiConfig: () => state.hasConfig,
}));

const { POST } = await import("./route");

function request(body: unknown) {
  return new Request("http://localhost/api/review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.client = null;
  state.hasConfig = true;
});

describe("POST /api/review", () => {
  it("reviews a batch of comments and returns category, tier, reason, draft, and verification side by side", async () => {
    state.client = new FakeGeminiClient({
      classify: async (text) =>
        text === TEST_COMMENTS.simpleCheer
          ? { category: "GENERAL_REACTION", mixedSignals: false }
          : { category: "AD_OR_UNRELATED", mixedSignals: false },
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: TEST_COMMENTS.simpleCheer, publishedAt: "2026-01-01T00:00:00Z" },
          { threadId: "t2", topLevelCommentId: "c2", text: TEST_COMMENTS.ad, publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toMatch(/no-store/);
    expect(body.items).toHaveLength(2);
    expect(body.items[0].classification.tier).toBe("AUTO_REPLY_CANDIDATE");
    expect(body.items[0].draft).toBe("응원 감사합니다!");
    expect(body.items[0].verification.passed).toBe(true);
    expect(body.items[1].classification.tier).toBe("NO_REPLY");
    expect(body.items[1].draft).toBeNull();
  });

  it("rejects a malformed comments payload", async () => {
    state.client = new FakeGeminiClient({});
    const response = await POST(request({ comments: [{ nope: true }] }));
    expect(response.status).toBe(400);
  });

  it("rejects zero comments", async () => {
    state.client = new FakeGeminiClient({});
    const response = await POST(request({ comments: [] }));
    expect(response.status).toBe(400);
  });

  it("rejects more than 20 comments without calling Gemini", async () => {
    const classify = vi.fn(async () => ({ category: "AD_OR_UNRELATED" as const, mixedSignals: false }));
    state.client = new FakeGeminiClient({ classify });
    const comments = Array.from({ length: 21 }, (_, i) => ({
      threadId: `t${i}`,
      topLevelCommentId: `c${i}`,
      text: TEST_COMMENTS.ad,
      publishedAt: "2026-01-01T00:00:00Z",
    }));

    const response = await POST(request({ comments }));

    expect(response.status).toBe(400);
    expect(classify).not.toHaveBeenCalled();
  });

  it("rejects duplicate comment IDs in the same batch", async () => {
    state.client = new FakeGeminiClient({});
    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "dup", text: "a", publishedAt: "2026-01-01T00:00:00Z" },
          { threadId: "t2", topLevelCommentId: "dup", text: "b", publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    expect(response.status).toBe(400);
  });

  it("rejects an invalid publishedAt value", async () => {
    state.client = new FakeGeminiClient({});
    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: "a", publishedAt: "not-a-date" },
        ],
      }),
    );
    expect(response.status).toBe(400);
  });

  it("returns a safe 500 instead of a raw exception when createRealGeminiClient itself throws", async () => {
    // state.client is intentionally left null here — the mocked
    // createRealGeminiClient throws "test did not set state.client" in that
    // case, which stands in for any unexpected client-construction failure.
    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: TEST_COMMENTS.simpleCheer, publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.message).not.toMatch(/state\.client/);
  });

  it("fails fast with a safe config_missing error when GEMINI_API_KEY/GEMINI_MODEL are absent, without ever constructing a client", async () => {
    state.hasConfig = false;
    state.client = null; // would throw synchronously if createRealGeminiClient were reached

    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: TEST_COMMENTS.simpleCheer, publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.status).toBe("error");
    expect(body.reason).toBe("config_missing");
    expect(body.message).not.toMatch(/GEMINI_API_KEY|GEMINI_MODEL/);
  });

  it("returns status 'partial' — not 'ok' — when any item was downgraded by a Gemini failure, while still returning every safe item", async () => {
    state.client = new FakeGeminiClient({
      classify: async (text) => {
        if (text === TEST_COMMENTS.simpleCheer) {
          throw new ApiError({ message: "unauthorized, key=sk-live-secret", status: 401 });
        }
        return { category: "AD_OR_UNRELATED", mixedSignals: false };
      },
    });

    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: TEST_COMMENTS.simpleCheer, publishedAt: "2026-01-01T00:00:00Z" },
          { threadId: "t2", topLevelCommentId: "c2", text: TEST_COMMENTS.ad, publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const body = await response.json();
    const raw = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.status).toBe("partial");
    expect(body.items).toHaveLength(2);
    expect(body.items[0].classification.tier).toBe("HUMAN_REVIEW");
    expect(body.items[0].geminiIssue).toEqual({ stage: "classification", reason: "auth_error" });
    expect(body.items[0].classification.category).toBe("UNKNOWN");
    expect(body.items[1].classification.tier).toBe("NO_REPLY");
    expect(body.items[1].geminiIssue).toBeNull();
    expect(raw).not.toContain("sk-live-secret");
  });

  it("keeps the successful fixture's status 'ok' and every geminiIssue null when nothing failed", async () => {
    state.client = new FakeGeminiClient({
      classify: async (text) =>
        text === TEST_COMMENTS.simpleCheer
          ? { category: "GENERAL_REACTION", mixedSignals: false }
          : { category: "AD_OR_UNRELATED", mixedSignals: false },
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const response = await POST(
      request({
        comments: [
          { threadId: "t1", topLevelCommentId: "c1", text: TEST_COMMENTS.simpleCheer, publishedAt: "2026-01-01T00:00:00Z" },
          { threadId: "t2", topLevelCommentId: "c2", text: TEST_COMMENTS.ad, publishedAt: "2026-01-01T00:00:00Z" },
        ],
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.items.every((item: { geminiIssue: unknown }) => item.geminiIssue === null)).toBe(true);
  });
});
