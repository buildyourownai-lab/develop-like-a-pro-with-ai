import { createHash, randomBytes } from "node:crypto";

function base64UrlEncode(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 7636 PKCE code_verifier: a high-entropy random string, base64url-encoded. */
export function generateCodeVerifier() {
  return base64UrlEncode(randomBytes(32));
}

/** RFC 7636 PKCE code_challenge for the S256 method: base64url(sha256(verifier)). */
export function generateCodeChallenge(verifier) {
  return base64UrlEncode(createHash("sha256").update(verifier).digest());
}

/** A random per-run value the callback must echo back, to detect CSRF/replayed callbacks. */
export function generateState() {
  return base64UrlEncode(randomBytes(16));
}
