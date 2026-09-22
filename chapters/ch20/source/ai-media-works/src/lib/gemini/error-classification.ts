import { ApiError } from "@google/genai";
import { GeminiSchemaError } from "./schema";
import { GeminiConfigMissingError } from "./errors";

/**
 * A closed set of safe reasons a Gemini call can be classified into. Every
 * throw site upstream of this function may carry an error.message that
 * embeds an API key fragment, a host, a file path, or a raw response body —
 * this function never reads that text, and no caller forwards it to the
 * browser. Only the reason label below crosses that boundary.
 */
export type GeminiIssueReason =
  | "config_missing"
  | "auth_error"
  | "quota_exceeded"
  | "model_or_request_error"
  | "network_error"
  | "invalid_response"
  | "service_error";

// @google/genai's HTTPClientError subclasses (ConnectionError,
// RequestTimeoutError, RequestAbortedError) are not exported from the
// package, so they cannot be matched with instanceof — only by this fixed
// `name` value, which is a stable identifier the SDK sets itself, not a
// free-form message.
const NETWORK_ERROR_NAMES = new Set(["ConnectionError", "RequestTimeoutError", "RequestAbortedError"]);

export function classifyGeminiError(error: unknown): GeminiIssueReason {
  if (error instanceof GeminiSchemaError) {
    return "invalid_response";
  }
  if (error instanceof GeminiConfigMissingError) {
    return "config_missing";
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      return "auth_error";
    }
    if (error.status === 429) {
      return "quota_exceeded";
    }
    if (error.status === 400 || error.status === 404) {
      return "model_or_request_error";
    }
    return "service_error";
  }
  if (error instanceof TypeError) {
    return "network_error";
  }
  if (error instanceof Error && NETWORK_ERROR_NAMES.has(error.name)) {
    return "network_error";
  }
  return "service_error";
}

/** Fixed, safe Korean text for each reason — never built from error.message. */
export const GEMINI_ISSUE_MESSAGE: Record<GeminiIssueReason, string> = {
  config_missing: "서버에 Gemini 연동 설정이 없습니다.",
  auth_error: "Gemini 인증에 실패했습니다.",
  quota_exceeded: "Gemini API 사용량 한도에 도달했습니다.",
  model_or_request_error: "Gemini 모델 또는 요청 형식을 확인하지 못했습니다.",
  network_error: "Gemini와 통신하지 못했습니다.",
  invalid_response: "Gemini 응답 형식을 확인하지 못했습니다.",
  service_error: "Gemini 서비스에서 예상하지 못한 오류가 발생했습니다.",
};
