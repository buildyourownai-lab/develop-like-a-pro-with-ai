/**
 * Typed errors for the auto-reply state store, in the same spirit as
 * src/lib/youtube/errors.ts: a caller classifies by instanceof, never by
 * matching a message, and no message reaches the browser.
 */

/** SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing on the server. */
export class AutoReplyConfigMissingError extends Error {}

/** The store answered, but not with a shape this app recognizes. */
export class AutoReplyStoreResponseError extends Error {}

/**
 * The store call failed at the transport or HTTP level. The message holds
 * only a status code — never the URL, the key, or the response body, any of
 * which could carry the service role key or a row's contents into a log.
 */
export class AutoReplyStoreRequestError extends Error {}

export const STORE_ERROR_REASONS = [
  "store_config_missing",
  "store_unavailable",
  "store_invalid_response",
] as const;
export type StoreErrorReason = (typeof STORE_ERROR_REASONS)[number];

export function classifyStoreError(error: unknown): StoreErrorReason {
  if (error instanceof AutoReplyConfigMissingError) return "store_config_missing";
  if (error instanceof AutoReplyStoreResponseError) return "store_invalid_response";
  return "store_unavailable";
}

export const STORE_ERROR_MESSAGE: Record<StoreErrorReason, string> = {
  store_config_missing: "서버에 자동답글 상태 저장 설정이 아직 없습니다.",
  store_unavailable: "자동답글 상태 저장소와 통신하지 못했습니다.",
  store_invalid_response: "자동답글 상태 저장소의 응답 형식을 확인하지 못했습니다.",
};
