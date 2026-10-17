#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadOAuthClient } from "./lib/client-json.mjs";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "./lib/pkce.mjs";
import { startCallbackServer } from "./lib/callback-server.mjs";
import { exchangeCodeForToken, YOUTUBE_COMMENT_READ_SCOPE } from "./lib/token-exchange.mjs";
import { saveTokenFile } from "./lib/secure-store.mjs";
import { DEFAULT_TOKEN_RELATIVE_PATH, resolveTokenOutputPath } from "./lib/token-output-path.mjs";

/**
 * One-time local setup for chapter 19's YouTube comment-reading access.
 * Reuses the chapter 18 OAuth Desktop client JSON (read-only reuse: this
 * script never writes to that file) and saves a *separate* token file
 * scoped to youtube.force-ssl — the only scope the current YouTube Data
 * API v3 Discovery document lists for commentThreads.list/comments.list —
 * so chapter 18's token file is never touched.
 *
 * Google's console labels youtube.force-ssl broadly, but this app grants
 * itself no more than that label implies: it only ever calls
 * channels.list / videos.list / commentThreads.list (all GET) and has no
 * comments.insert / update / delete or other write path
 * (see src/lib/youtube/real-client.ts).
 *
 * Nothing this script prints ever includes the authorization code, the
 * access/refresh token, or the client secret — only status, the scope
 * name, and file paths.
 */

const PORT = 51823;
const CALLBACK_PATH = "/oauth2callback";
const REDIRECT_URI = `http://127.0.0.1:${PORT}${CALLBACK_PATH}`;
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const TIMEOUT_MS = 5 * 60 * 1000;

// The beginner CLI flow always saves to this one fixed path inside the
// project — there is no command-line way to point it anywhere else, so it
// can never be pointed at chapter 18's token file or a file outside the
// project by accident.
const PROJECT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export function buildAuthUrl({ clientId, state, codeChallenge }) {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", YOUTUBE_COMMENT_READ_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function run({ clientJsonPath, tokenOutputPath = DEFAULT_TOKEN_RELATIVE_PATH } = {}) {
  if (!clientJsonPath) {
    return {
      ok: false,
      reason: "missing_argument",
      message: "사용법: npm run setup:youtube-comment-read -- <client_secret.json 경로>",
    };
  }

  let clientId;
  let clientSecret;
  try {
    ({ clientId, clientSecret } = loadOAuthClient(clientJsonPath));
  } catch (error) {
    return { ok: false, reason: "client_json_error", message: error.message };
  }

  // Fail fast, before ever starting the OAuth flow, if the token would
  // land outside the project or on top of the client JSON file.
  const resolvedTokenPath = resolveTokenOutputPath({
    projectRoot: PROJECT_ROOT,
    clientJsonPath,
    tokenOutputPath,
  });
  if (!resolvedTokenPath.ok) {
    return resolvedTokenPath;
  }

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = generateState();
  const authUrl = buildAuthUrl({ clientId, state, codeChallenge });

  const callback = startCallbackServer({
    port: PORT,
    path: CALLBACK_PATH,
    expectedState: state,
    timeoutMs: TIMEOUT_MS,
  });

  // The consent URL is only printed once the local callback server has
  // confirmed it is actually listening — printing it earlier would let a
  // fast user click through to a redirect target that is not ready yet
  // (or, on a port conflict, one that never will be).
  const ready = await callback.ready;
  if (!ready.ok) {
    return { ok: false, reason: ready.reason, message: ready.message };
  }

  console.log("아래 URL을 브라우저에서 열어 Google 동의를 진행하세요:");
  console.log(authUrl);
  console.log(
    `\n요청 범위: ${YOUTUBE_COMMENT_READ_SCOPE}\n${Math.round(TIMEOUT_MS / 60000)}분 안에 동의를 완료하세요. Ctrl+C로 취소할 수 있습니다.`,
  );

  const onSigint = () => callback.cancel();
  process.once("SIGINT", onSigint);
  const outcome = await callback.result;
  process.off("SIGINT", onSigint);

  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason, message: outcome.message };
  }

  const exchange = await exchangeCodeForToken({
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId,
    clientSecret,
    code: outcome.code,
    codeVerifier,
    redirectUri: REDIRECT_URI,
  });

  if (!exchange.ok) {
    return { ok: false, reason: exchange.reason, message: exchange.message };
  }

  saveTokenFile(resolvedTokenPath.path, {
    refresh_token: exchange.token.refresh_token,
    scope: exchange.token.scope,
    saved_at: new Date().toISOString(),
  });

  return {
    ok: true,
    tokenOutputPath: resolvedTokenPath.path,
    scope: exchange.token.scope,
  };
}

async function main() {
  const [clientJsonPath] = process.argv.slice(2);
  const outcome = await run({ clientJsonPath });

  if (!outcome.ok) {
    console.error(`\n설정을 완료하지 못했습니다: ${outcome.message}`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n댓글 읽기용 Token을 저장했습니다: ${outcome.tokenOutputPath} (본인만 읽기 가능하도록 권한을 제한했습니다)`);
  console.log(`부여된 scope: ${outcome.scope}`);
}

const isMainModule = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
