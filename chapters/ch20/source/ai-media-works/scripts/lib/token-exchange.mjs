// YouTube Data API v3's current Discovery document lists this as the only
// scope authorizing commentThreads.list (and comments.list) — youtube.readonly
// does not appear in either method's scope list there, despite the common
// assumption that it covers all read calls. Google's console labels
// youtube.force-ssl broadly ("YouTube 데이터 관리"), but this app only ever
// calls channels.list / videos.list / commentThreads.list (all GET) — see
// src/lib/youtube/real-client.ts, which has no write method to call by
// mistake. (Provenance: Google YouTube Data API v3 Discovery document,
// checked 2026-09-14, after a real commentThreads.list call returned HTTP
// 403 insufficientPermissions for a youtube.readonly-scoped token.)
//
// This app accepts ONLY youtube.force-ssl, exactly one scope, no other YouTube
// scope mixed in (youtube.readonly, youtube, youtube.upload, even if force-ssl
// is also present) — the setup script and the runtime loader both enforce this
// before any network call to prevent silently granting write access the fixed
// source never uses.
export const YOUTUBE_COMMENT_READ_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

/**
 * Validates a token response from Google's token endpoint. Fail-closed on
 * every axis this setup flow cares about: no refresh_token (Google omits it
 * when the user already granted consent and prompt=consent was somehow not
 * honored), granted scope is not exactly youtube.force-ssl alone (any other
 * YouTube scope mixed in, even if force-ssl is present, is rejected — this
 * chapter's fixed source only calls GET read methods, so granting write or
 * upload scope would be silently wrong), both refuse to hand back a usable
 * token rather than saving something that looks valid but violates the scope
 * contract this chapter documents.
 */
export function validateTokenResponse(body) {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "invalid_response", message: "Token 응답 형식이 올바르지 않습니다." };
  }

  const refreshToken = body.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    return {
      ok: false,
      reason: "missing_refresh_token",
      message:
        "refresh_token이 응답에 없습니다. Google 계정의 보안 → 타사 앱 액세스에서 이 앱 접근을 제거한 뒤 다시 시도하세요.",
    };
  }

  const scope = body.scope;
  const grantedScopes = typeof scope === "string" ? scope.split(" ").filter(Boolean) : [];
  if (grantedScopes.length !== 1 || grantedScopes[0] !== YOUTUBE_COMMENT_READ_SCOPE) {
    return {
      ok: false,
      reason: "wrong_scope",
      message: `필요한 범위(${YOUTUBE_COMMENT_READ_SCOPE}) 하나만 정확히 부여되어야 합니다. 동의 화면에서 이 권한만 허용했는지 확인하세요.`,
    };
  }

  return { ok: true, token: { refresh_token: refreshToken, scope } };
}

/**
 * Exchanges an authorization code for tokens via the standard PKCE flow.
 * `fetchImpl` is injectable so tests never make a real network call.
 */
export async function exchangeCodeForToken(
  { tokenEndpoint, clientId, clientSecret, code, codeVerifier, redirectUri },
  fetchImpl = fetch,
) {
  let response;
  try {
    response = await fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
  } catch {
    return { ok: false, reason: "network_error", message: "Google Token 서버와 통신하지 못했습니다." };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { ok: false, reason: "token_exchange_failed", message: "Token 응답을 JSON으로 읽지 못했습니다." };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "token_exchange_failed",
      message: `Token 교환이 실패했습니다 (HTTP ${response.status}).`,
    };
  }

  return validateTokenResponse(body);
}
