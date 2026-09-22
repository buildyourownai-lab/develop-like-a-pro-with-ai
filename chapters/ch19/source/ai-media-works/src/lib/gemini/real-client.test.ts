import { ApiError } from "@google/genai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classifyGeminiError } from "./error-classification";
import { GeminiConfigMissingError } from "./errors";
import { GeminiSchemaError } from "./schema";
import { createRealGeminiClient, hasGeminiConfig } from "./real-client";

/**
 * Boundary test for the real Gemini client: mocks only the @google/genai
 * SDK call, not our own parsing, so this proves the full path from "text
 * the model returned" to "typed output or thrown error" is fail-closed —
 * not just the parseXOutput functions in isolation (schema.test.ts).
 */

const state = vi.hoisted(() => ({
  responseText: undefined as string | undefined,
  throwError: undefined as unknown,
  requests: [] as Array<{ contents?: unknown }>,
}));

vi.mock("@google/genai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@google/genai")>();
  return {
    ...actual,
    GoogleGenAI: class {
      models = {
        generateContent: async (request: { contents?: unknown }) => {
          state.requests.push(request);
          if (state.throwError) throw state.throwError;
          return { text: state.responseText };
        },
      };
    },
  };
});

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_MODEL = "test-model";
  state.responseText = undefined;
  state.throwError = undefined;
  state.requests = [];
});

describe("createRealGeminiClient — classifyComment fail-closed boundary", () => {
  it("returns a typed result for a well-formed response", async () => {
    state.responseText = '{"category":"GENERAL_REACTION","mixedSignals":false}';
    const client = createRealGeminiClient();

    await expect(client.classifyComment("잘 봤습니다.")).resolves.toEqual({
      category: "GENERAL_REACTION",
      mixedSignals: false,
    });
  });

  it("throws instead of returning a value for malformed JSON", async () => {
    state.responseText = "not json at all";
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws when the model returns no text at all", async () => {
    state.responseText = undefined;
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws for an unknown category instead of passing it through unchecked", async () => {
    state.responseText = '{"category":"SPAM","mixedSignals":false}';
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws when mixedSignals is the string \"false\" (the exact Boolean() coercion bug)", async () => {
    state.responseText = '{"category":"GENERAL_REACTION","mixedSignals":"false"}';
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiSchemaError);
  });
});

describe("createRealGeminiClient — generateDraft fail-closed boundary", () => {
  it("asks for thanks from the video publisher's perspective", async () => {
    state.responseText = '{"draft":"댓글 남겨주셔서 감사합니다."}';
    const client = createRealGeminiClient();

    await client.generateDraft("2천년 전 기술이 대단하네요.", "GENERAL_REACTION");

    expect(state.requests[0]?.contents).toContain("영상 게시자 관점에서 시청자에게 감사한다.");
  });

  it("throws for a null draft field", async () => {
    state.responseText = '{"draft":null}';
    const client = createRealGeminiClient();

    await expect(client.generateDraft("x", "GENERAL_REACTION")).rejects.toThrow(
      GeminiSchemaError,
    );
  });

  it("throws for an array draft field instead of stringifying it", async () => {
    state.responseText = '{"draft":["a","b"]}';
    const client = createRealGeminiClient();

    await expect(client.generateDraft("x", "GENERAL_REACTION")).rejects.toThrow(
      GeminiSchemaError,
    );
  });
});

describe("createRealGeminiClient — checkDraftContext fail-closed boundary", () => {
  it("passes only when passed is exactly boolean true", async () => {
    state.responseText = '{"passed":true,"reason":"ok"}';
    const client = createRealGeminiClient();

    await expect(client.checkDraftContext("x", "draft")).resolves.toEqual({
      passed: true,
      reason: "ok",
    });
  });

  it("throws for a string \"false\" passed value instead of returning passed:true", async () => {
    state.responseText = '{"passed":"false","reason":"ok"}';
    const client = createRealGeminiClient();

    await expect(client.checkDraftContext("x", "draft")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws for a numeric passed value", async () => {
    state.responseText = '{"passed":1,"reason":"ok"}';
    const client = createRealGeminiClient();

    await expect(client.checkDraftContext("x", "draft")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws for a null response body", async () => {
    state.responseText = "null";
    const client = createRealGeminiClient();

    await expect(client.checkDraftContext("x", "draft")).rejects.toThrow(GeminiSchemaError);
  });

  it("throws for an array response body", async () => {
    state.responseText = "[true]";
    const client = createRealGeminiClient();

    await expect(client.checkDraftContext("x", "draft")).rejects.toThrow(GeminiSchemaError);
  });
});

describe("hasGeminiConfig", () => {
  it("is true only when both GEMINI_API_KEY and GEMINI_MODEL are set", () => {
    expect(hasGeminiConfig()).toBe(true);

    delete process.env.GEMINI_API_KEY;
    expect(hasGeminiConfig()).toBe(false);
    process.env.GEMINI_API_KEY = "test-key";

    delete process.env.GEMINI_MODEL;
    expect(hasGeminiConfig()).toBe(false);
    process.env.GEMINI_MODEL = "test-model";
  });
});

describe("createRealGeminiClient — missing configuration throws a typed error", () => {
  it("throws GeminiConfigMissingError, classified as config_missing, when GEMINI_API_KEY is absent", async () => {
    delete process.env.GEMINI_API_KEY;
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiConfigMissingError);
    process.env.GEMINI_API_KEY = "test-key";
  });

  it("throws GeminiConfigMissingError when GEMINI_MODEL is absent", async () => {
    delete process.env.GEMINI_MODEL;
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toThrow(GeminiConfigMissingError);
    process.env.GEMINI_MODEL = "test-model";
  });
});

describe("createRealGeminiClient — SDK errors propagate for classification, not silently swallowed", () => {
  it("propagates a 401 ApiError so it classifies as auth_error", async () => {
    state.throwError = new ApiError({ message: "unauthorized", status: 401 });
    const client = createRealGeminiClient();

    await expect(client.classifyComment("x")).rejects.toBeInstanceOf(ApiError);
    try {
      await client.classifyComment("x");
    } catch (error) {
      expect(classifyGeminiError(error)).toBe("auth_error");
    }
  });

  it("propagates a 429 ApiError so it classifies as quota_exceeded", async () => {
    state.throwError = new ApiError({ message: "rate limited", status: 429 });
    const client = createRealGeminiClient();

    try {
      await client.generateDraft("x", "GENERAL_REACTION");
      throw new Error("expected generateDraft to reject");
    } catch (error) {
      expect(classifyGeminiError(error)).toBe("quota_exceeded");
    }
  });

  it("propagates a fetch-style TypeError so it classifies as network_error", async () => {
    state.throwError = new TypeError("fetch failed");
    const client = createRealGeminiClient();

    try {
      await client.checkDraftContext("x", "draft");
      throw new Error("expected checkDraftContext to reject");
    } catch (error) {
      expect(classifyGeminiError(error)).toBe("network_error");
    }
  });
});
