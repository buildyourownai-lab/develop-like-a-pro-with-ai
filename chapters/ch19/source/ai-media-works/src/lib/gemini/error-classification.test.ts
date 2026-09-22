import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { classifyGeminiError, GEMINI_ISSUE_MESSAGE, GeminiIssueReason } from "./error-classification";
import { GeminiConfigMissingError } from "./errors";
import { GeminiSchemaError } from "./schema";

const ALL_REASONS: GeminiIssueReason[] = [
  "config_missing",
  "auth_error",
  "quota_exceeded",
  "model_or_request_error",
  "network_error",
  "invalid_response",
  "service_error",
];

describe("classifyGeminiError — closed reason set", () => {
  it("classifies a missing-config error", () => {
    const error = new GeminiConfigMissingError("GEMINI_API_KEY is not set on the server.");
    expect(classifyGeminiError(error)).toBe("config_missing");
  });

  it("classifies 401 and 403 ApiError as auth_error", () => {
    expect(classifyGeminiError(new ApiError({ message: "unauthorized", status: 401 }))).toBe("auth_error");
    expect(classifyGeminiError(new ApiError({ message: "forbidden", status: 403 }))).toBe("auth_error");
  });

  it("classifies a 429 ApiError as quota_exceeded", () => {
    expect(classifyGeminiError(new ApiError({ message: "rate limited", status: 429 }))).toBe("quota_exceeded");
  });

  it("classifies 400 and 404 ApiError as model_or_request_error", () => {
    expect(classifyGeminiError(new ApiError({ message: "bad request", status: 400 }))).toBe(
      "model_or_request_error",
    );
    expect(classifyGeminiError(new ApiError({ message: "unknown model", status: 404 }))).toBe(
      "model_or_request_error",
    );
  });

  it("classifies any other ApiError status as service_error", () => {
    expect(classifyGeminiError(new ApiError({ message: "server error", status: 500 }))).toBe("service_error");
  });

  it("classifies a fetch-style TypeError as network_error", () => {
    expect(classifyGeminiError(new TypeError("fetch failed"))).toBe("network_error");
  });

  it("classifies the SDK's own HTTPClientError subclasses as network_error by their fixed name", () => {
    const connectionError = new Error("some internal wording");
    connectionError.name = "ConnectionError";
    expect(classifyGeminiError(connectionError)).toBe("network_error");

    const timeoutError = new Error("some internal wording");
    timeoutError.name = "RequestTimeoutError";
    expect(classifyGeminiError(timeoutError)).toBe("network_error");
  });

  it("classifies a GeminiSchemaError (malformed model output) as invalid_response", () => {
    expect(classifyGeminiError(new GeminiSchemaError("bad shape"))).toBe("invalid_response");
  });

  it("classifies an unrecognized error as service_error rather than throwing or guessing", () => {
    expect(classifyGeminiError(new Error("something odd"))).toBe("service_error");
    expect(classifyGeminiError("not even an Error instance")).toBe("service_error");
    expect(classifyGeminiError(undefined)).toBe("service_error");
  });

  it("never forwards the raw error message — only a fixed Korean string per reason", () => {
    const secretLike = "sk-live-abc123 at /Users/alice/.secrets/gemini.json against api.example.internal";
    const error = new ApiError({ message: secretLike, status: 401 });
    const reason = classifyGeminiError(error);
    const message = GEMINI_ISSUE_MESSAGE[reason];
    expect(message).not.toContain(secretLike);
    expect(message).not.toContain("/Users/");
    expect(message).not.toContain("api.example.internal");
    expect(message).not.toContain("sk-live");
  });

  it("has a fixed Korean message for every reason in the closed set", () => {
    for (const reason of ALL_REASONS) {
      expect(GEMINI_ISSUE_MESSAGE[reason]).toBeTruthy();
    }
  });
});
