import { requestSignal } from "../execution-budget";
import { readFileSync } from "node:fs";
import {
  YoutubeAuthError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeInvalidResponseError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
} from "./errors";

/**
 * The one place OAuth credentials are loaded and the one place an access
 * token is obtained. Both the read client (channels/videos/commentThreads
 * list) and the reply client (comments.insert / comments.list) go through
 * here, so a single refresh token file is reused and a single in-memory
 * access token is shared instead of each client refreshing on its own.
 *
 * Two credentials are needed: an OAuth Desktop client JSON (shared,
 * read-only reuse of the chapter 18 Cloud project) and the comment token
 * document written by scripts/setup-youtube-comment-read-oauth.mjs. Each one
 * may arrive as a local file path or as an inline environment value — see
 * resolveCredentialSource below. Nothing here writes either one, and no part
 * of either one is ever logged or put into an error message.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

// The YouTube Data API v3 Discovery document lists youtube.force-ssl as the
// only scope that authorizes commentThreads.list, comments.list, and
// comments.insert — it does NOT list youtube.readonly or the plain youtube
// scope for the comment methods, despite both being commonly assumed to
// cover them. (Provenance: Google YouTube Data API v3 Discovery document,
// checked 2026-09-14, after a real commentThreads.list call on an owned
// public video returned HTTP 403 insufficientPermissions for a
// youtube.readonly token.)
//
// Chapter 19 held this token while calling only GET methods. Chapter 20 adds
// exactly one write method (comments.insert, a reply to one top-level
// comment on one approved video) and nothing else — no update, no delete, no
// moderation status, no video change. src/app/bounded-write-surface.test.ts
// re-checks that boundary statically on every test run.
export const YOUTUBE_COMMENT_SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl";

// This app accepts ONLY youtube.force-ssl, exactly one scope, no other
// YouTube scope mixed in (youtube.readonly, youtube, youtube.upload, even if
// force-ssl is also present) — the runtime loader enforces this before any
// network call, so a token carrying broader access than this chapter's fixed
// source uses is refused rather than silently accepted.
const ALLOWED_SCOPES: readonly string[] = [YOUTUBE_COMMENT_SCOPE];
const ALLOWED_SCOPES_COUNT = 1;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

// In-memory only — never written to disk, a database, or a log.
let cachedToken: CachedToken | null = null;

/**
 * The environment variable names each credential may arrive under.
 *
 * Chapter 19 read both credentials from files, which is right on the machine
 * that ran the consent flow: the setup script writes the token file itself, at
 * 0600, and a path in .env.local keeps the secret out of the environment. But a
 * serverless deployment has nowhere to put such a file — Vercel's filesystem is
 * read-only at runtime, .env.local is not deployed, and the build has no access
 * to the operator's machine — so a path-only loader could never run there at
 * all. Hence a second accepted source per credential:
 *
 *   YOUTUBE_OAUTH_CLIENT_JSON              the client JSON, or base64 of it
 *   YOUTUBE_OAUTH_CLIENT_JSON_PATH         a file holding that same JSON
 *
 *   YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON  the token JSON, or base64 of it
 *   YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH  a file holding that same JSON
 */
const CLIENT_INLINE_ENV = "YOUTUBE_OAUTH_CLIENT_JSON";
const CLIENT_PATH_ENV = "YOUTUBE_OAUTH_CLIENT_JSON_PATH";
const TOKEN_INLINE_ENV = "YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON";
const TOKEN_PATH_ENV = "YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH";

type CredentialSource = { kind: "inline"; value: string } | { kind: "file"; path: string };

/** An unset variable and one set to whitespace are the same thing: absent. */
function readEnvValue(name: string): string | null {
  const value = process.env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Decides where one credential comes from. Exactly one source, decided the same
 * way every time:
 *
 *   neither set  → config missing
 *   one set      → that one
 *   both set     → refused
 *
 * Both-set is deliberately NOT resolved by letting one win. The failure that
 * rule would create is the hardest kind to see: a deployment quietly keeps
 * using a stale secret from the variable somebody forgot about, while the one
 * they just corrected is ignored, and every symptom points at the wrong place.
 * Refusing says which two names collided, immediately, and never depends on
 * which value looks fresher.
 *
 * The two credentials resolve independently, so an inline client JSON together
 * with a local token file is a valid combination.
 */
function resolveCredentialSource(inlineEnv: string, pathEnv: string): CredentialSource {
  const inline = readEnvValue(inlineEnv);
  const path = readEnvValue(pathEnv);
  if (inline !== null && path !== null) {
    // Names only. Neither value is quoted, measured, or hinted at.
    throw new YoutubeConfigMissingError(
      `${inlineEnv} and ${pathEnv} are both set on the server. Set exactly one of them.`,
    );
  }
  if (inline !== null) return { kind: "inline", value: inline };
  if (path !== null) return { kind: "file", path };
  throw new YoutubeConfigMissingError(`${inlineEnv} or ${pathEnv} is not set on the server.`);
}

/**
 * Turns an inline value into the JSON text it stands for.
 *
 * It is either the JSON document itself or that same document base64-encoded,
 * and the two are told apart by the first character — a JSON object starts with
 * "{", which base64 cannot produce. base64 is worth accepting because a
 * deployment dashboard's variable field is a single line: a pasted multi-line
 * client_secret*.json arrives with its newlines mangled often enough that a
 * one-line encoding is the safer thing to ask a person for. Both the standard
 * and the URL-safe alphabet are accepted, because different tools emit
 * different ones (`base64` and `base64 -w0` versus `jq -r @base64`).
 *
 * A value that is neither shape is rejected here rather than fed to a decoder
 * that would turn it into unpredictable bytes.
 */
function decodeInlineCredential(value: string): string {
  if (value.startsWith("{")) {
    return value;
  }
  // Wrapping whitespace is what `base64` without -w0 produces, so it is removed
  // rather than treated as a mistake.
  const packed = value.replace(/\s+/g, "");
  if (packed.length === 0 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(packed)) {
    throw new Error("inline credential value is neither a JSON object nor base64");
  }
  return Buffer.from(packed, "base64").toString("utf8");
}

/**
 * Reads one credential document from whichever single source is configured, and
 * hands back a plain object for the shape checks below to work on.
 *
 * The caught error is deliberately never read or re-thrown. JSON.parse quotes
 * the input it choked on, and for an inline value that input IS the secret — so
 * a "helpful" wrapped message would be the one place in this file where a
 * client secret or a refresh token could reach a log.
 */
function loadCredentialRecord(
  source: CredentialSource,
  messages: { unreadable: string; notAnObject: string },
): Record<string, unknown> {
  let raw: unknown;
  try {
    const text =
      source.kind === "file"
        ? readFileSync(source.path, "utf8")
        : decodeInlineCredential(source.value);
    raw = JSON.parse(text);
  } catch {
    throw new YoutubeCredentialFileError(messages.unreadable);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new YoutubeCredentialFileError(messages.notAnObject);
  }
  return raw as Record<string, unknown>;
}

/**
 * Whether both credentials have a source configured at all.
 *
 * Presence only: nothing is read, decoded, or validated, and a credential with
 * both of its sources set counts as present here — the loaders above are what
 * refuse that. So this can answer "are the names filled in" for the local
 * screen's banner without ever touching a secret, and it still must not be
 * presented as "this works", because no call has been made.
 */
export function hasYoutubeCredentialConfig(): boolean {
  const clientConfigured =
    readEnvValue(CLIENT_INLINE_ENV) !== null || readEnvValue(CLIENT_PATH_ENV) !== null;
  const tokenConfigured =
    readEnvValue(TOKEN_INLINE_ENV) !== null || readEnvValue(TOKEN_PATH_ENV) !== null;
  return clientConfigured && tokenConfigured;
}

export function loadClientCredentials(): { clientId: string; clientSecret: string } {
  const record = loadCredentialRecord(
    resolveCredentialSource(CLIENT_INLINE_ENV, CLIENT_PATH_ENV),
    {
      unreadable: "OAuth client JSON을 읽거나 파싱할 수 없습니다.",
      notAnObject: "OAuth client JSON 형식이 올바르지 않습니다.",
    },
  );
  const inner = record.installed;
  if (typeof inner !== "object" || inner === null || Array.isArray(inner)) {
    throw new YoutubeCredentialFileError(
      "OAuth client JSON이 Desktop(installed) 클라이언트 형식이 아닙니다. Cloud Console에서 '데스크톱 앱' 유형으로 만든 client_secret*.json을 사용하세요.",
    );
  }
  const innerRecord = inner as Record<string, unknown>;
  const clientId = innerRecord.client_id;
  const clientSecret = innerRecord.client_secret;
  if (typeof clientId !== "string" || typeof clientSecret !== "string") {
    throw new YoutubeCredentialFileError("OAuth client JSON에 client_id/client_secret이 없습니다.");
  }
  return { clientId, clientSecret };
}

/**
 * The refresh token, but only out of a document that passes every shape and
 * scope check below. The checks are identical for both sources on purpose: an
 * inline value is not more trusted for having come from a deployment's
 * environment than a file is for sitting on disk.
 */
export function loadRefreshToken(): string {
  const record = loadCredentialRecord(
    resolveCredentialSource(TOKEN_INLINE_ENV, TOKEN_PATH_ENV),
    {
      unreadable: "댓글 Token JSON을 읽거나 파싱할 수 없습니다.",
      notAnObject: "댓글 Token JSON 형식이 올바르지 않습니다.",
    },
  );

  const refreshToken = record.refresh_token;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) {
    throw new YoutubeCredentialFileError("댓글 Token JSON에 refresh_token이 없습니다.");
  }

  // The document is trusted only after this check — a token saved under a
  // scope this app doesn't recognize (or edited by hand) must never be used
  // to call the YouTube API, even though refresh_token alone would work.
  // This rejects chapter 18's status-change token (scope youtube) and
  // youtube.readonly just as firmly as youtube.upload — per the current
  // Discovery contract, none of the three authorizes the comment methods. It
  // also rejects force-ssl mixed with any other scope.
  const grantedScopes = extractGrantedScopes(record);
  const hasExactlyAllowedScope =
    grantedScopes.length === ALLOWED_SCOPES_COUNT &&
    grantedScopes.every((grantedScope) => ALLOWED_SCOPES.includes(grantedScope));
  if (!hasExactlyAllowedScope) {
    throw new YoutubeScopeInsufficientError(
      `댓글 Token에 필요한 범위(${YOUTUBE_COMMENT_SCOPE}) 하나만 정확히 있어야 합니다. npm run setup:youtube-comment-read를 실행해 이 범위로 새 Token을 발급하세요.`,
    );
  }

  return refreshToken;
}

// Google's two OAuth token JSON shapes: a singular space-delimited "scope"
// string (this app's own setup script, and many OAuth libraries), or the
// "scopes" array that Python's Credentials.to_json produces. Only one shape
// is trusted per document — if "scope" is a string it wins, otherwise "scopes"
// must be a well-formed string array. Anything else (wrong type, non-string
// array entries) fails closed rather than silently granting access.
function extractGrantedScopes(record: Record<string, unknown>): string[] {
  const { scope, scopes } = record;
  if (typeof scope === "string") {
    return scope.split(" ").filter(Boolean);
  }
  if (Array.isArray(scopes)) {
    const result: string[] = [];
    for (const entry of scopes) {
      if (typeof entry !== "string") {
        throw new YoutubeCredentialFileError("댓글 Token JSON의 scopes 배열에 문자열이 아닌 값이 있습니다.");
      }
      if (entry.length > 0) {
        result.push(entry);
      }
    }
    return result;
  }
  return [];
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.accessToken;
  }

  const { clientId, clientSecret } = loadClientCredentials();
  const refreshToken = loadRefreshToken();

  const response = await fetch(TOKEN_ENDPOINT, {
    signal: requestSignal("oauth"),
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    // The token endpoint's error body (e.g. {"error":"invalid_grant",
    // "error_description": "..."}) is never read here — it can echo back
    // request details, and the status code alone is enough to classify the
    // failure safely. 400/401/403 (invalid_grant, invalid_client,
    // unauthorized_client, etc. all arrive as one of these) mean the refresh
    // token or client credentials are no longer valid; 429 means the token
    // endpoint itself is rate-limiting this app.
    if (response.status === 429) {
      throw new YoutubeQuotaExceededError(`Token refresh rate-limited with status ${response.status}`);
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      throw new YoutubeAuthError(`Token refresh failed with status ${response.status}`);
    }
    throw new Error(`Token refresh failed with status ${response.status}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new YoutubeInvalidResponseError("Token 갱신 응답을 JSON으로 읽지 못했습니다.");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답 형식이 올바르지 않습니다.");
  }
  const record = body as Record<string, unknown>;

  // A response with no access_token must never fall through to
  // `Authorization: Bearer undefined` — fail closed instead.
  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답에 access_token이 없습니다.");
  }

  const expiresIn = record.expires_in;
  if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new YoutubeInvalidResponseError("Token 갱신 응답에 유효한 expires_in이 없습니다.");
  }

  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return cachedToken.accessToken;
}
