import { YoutubeSchemaError } from "./schema";
import {
  YoutubeAuthError,
  YoutubeChannelNotFoundError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeInvalidResponseError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
  YoutubeVideoNotFoundError,
} from "./errors";

/**
 * A closed set of safe reasons an internal lookup failure can be classified
 * into. This is deliberately coarse — the point is that a raw error message
 * (which may name an unset env var, a file path, or an HTTP client's
 * internal wording) is never forwarded to the browser. Only the reason
 * label crosses that boundary; the Korean text for each reason is fixed and
 * defined here, never built from `error.message`.
 */
export type YoutubeLookupErrorReason =
  | "config_missing"
  | "credential_file_invalid"
  | "scope_insufficient"
  | "auth_error"
  | "quota_exceeded"
  | "network_error"
  | "invalid_response"
  | "video_not_found"
  | "channel_not_found"
  | "lookup_failed";

export function classifyYoutubeLookupError(error: unknown): YoutubeLookupErrorReason {
  if (error instanceof YoutubeVideoNotFoundError) {
    return "video_not_found";
  }
  if (error instanceof YoutubeChannelNotFoundError) {
    return "channel_not_found";
  }
  if (error instanceof YoutubeSchemaError) {
    return "invalid_response";
  }
  if (error instanceof YoutubeInvalidResponseError) {
    return "invalid_response";
  }
  if (error instanceof YoutubeConfigMissingError) {
    return "config_missing";
  }
  if (error instanceof YoutubeCredentialFileError) {
    return "credential_file_invalid";
  }
  if (error instanceof YoutubeScopeInsufficientError) {
    return "scope_insufficient";
  }
  if (error instanceof YoutubeAuthError) {
    return "auth_error";
  }
  if (error instanceof YoutubeQuotaExceededError) {
    return "quota_exceeded";
  }
  if (error instanceof TypeError) {
    return "network_error";
  }
  // Fallback pattern-matching below covers errors that reach this function
  // without going through the typed classes above (e.g. a caller's own
  // hand-built Error, or a client mocked directly in a route test).
  if (error instanceof Error) {
    if (/ is not set on the server\.$/.test(error.message)) {
      return "config_missing";
    }
    if (/failed with status (401|403)/.test(error.message)) {
      return "auth_error";
    }
    if (/failed with status 429/.test(error.message)) {
      return "quota_exceeded";
    }
    if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ECONNRESET/i.test(error.message)) {
      return "network_error";
    }
  }
  return "lookup_failed";
}

export const YOUTUBE_LOOKUP_ERROR_MESSAGE: Record<YoutubeLookupErrorReason, string> = {
  config_missing: "서버에 YouTube 연동 설정이 아직 없습니다.",
  credential_file_invalid: "YouTube 인증 설정을 읽거나 형식을 확인하지 못했습니다.",
  scope_insufficient: "인증 Token의 권한 범위가 부족합니다.",
  invalid_response: "YouTube 응답 형식을 확인하지 못했습니다.",
  video_not_found: "이 주소의 영상을 찾을 수 없거나 연결된 계정에서 볼 수 없습니다.",
  channel_not_found: "연결된 계정에서 내 YouTube 채널을 찾지 못했습니다.",
  auth_error: "인증이 만료되었거나 올바르지 않습니다.",
  quota_exceeded: "YouTube API 사용량 한도에 도달했습니다.",
  network_error: "YouTube와 통신하지 못했습니다.",
  lookup_failed: "정보를 확인하지 못했습니다.",
};
