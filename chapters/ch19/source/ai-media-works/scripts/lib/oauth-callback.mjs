/**
 * Classifies one incoming request to the local OAuth callback server.
 * Every branch is fail-closed: a missing/mismatched state, a provider error,
 * or a missing code all resolve to ok:false rather than guessing intent.
 */
export function parseCallbackRequest(requestUrl, expectedState) {
  let url;
  try {
    url = new URL(requestUrl, "http://127.0.0.1");
  } catch {
    return { ok: false, reason: "malformed_request", message: "콜백 요청 형식이 올바르지 않습니다." };
  }

  const params = url.searchParams;
  const error = params.get("error");
  if (error) {
    return error === "access_denied"
      ? { ok: false, reason: "cancelled", message: "동의 화면에서 취소했습니다." }
      : { ok: false, reason: "provider_error", message: `Google이 오류를 반환했습니다: ${error}` };
  }

  const state = params.get("state");
  if (typeof expectedState !== "string" || expectedState.length === 0) {
    return { ok: false, reason: "missing_expected_state", message: "내부 오류: 기대한 state 값이 없습니다." };
  }
  if (state !== expectedState) {
    return {
      ok: false,
      reason: "state_mismatch",
      message: "state 값이 일치하지 않습니다. 처음부터 다시 시작하세요.",
    };
  }

  const code = params.get("code");
  if (typeof code !== "string" || code.length === 0) {
    return { ok: false, reason: "missing_code", message: "인가 코드가 없습니다." };
  }

  return { ok: true, code };
}
