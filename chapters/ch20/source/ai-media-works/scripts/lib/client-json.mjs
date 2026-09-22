import { readFileSync } from "node:fs";

/**
 * Loads client_id/client_secret from a Google OAuth Desktop app client JSON
 * (the "installed" app type — the same client type/JSON shape chapter 18
 * downloads from Cloud Console, and the only shape this README documents).
 * A "web" client JSON or a flat (no `installed` wrapper) file is rejected
 * rather than guessed at, since a web client's redirect URI and secret
 * handling model differ from what this local PKCE flow assumes. This never
 * reads or overwrites chapter 18's own token file; it only reads the client
 * JSON, which chapter 19 reuses read-only.
 */
export function loadOAuthClient(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`OAuth client JSON 파일을 읽을 수 없습니다: ${path}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("OAuth client JSON 파일이 올바른 JSON이 아닙니다.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("OAuth client JSON 파일 형식이 올바르지 않습니다.");
  }

  const inner = parsed.installed;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new Error(
      "OAuth client JSON 파일이 Desktop(installed) 클라이언트 형식이 아닙니다. Cloud Console에서 '데스크톱 앱' 유형으로 만든 client_secret*.json을 사용하세요.",
    );
  }

  const clientId = inner.client_id;
  const clientSecret = inner.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new Error("OAuth client JSON 파일에 client_id/client_secret이 없습니다.");
  }

  return { clientId, clientSecret };
}
