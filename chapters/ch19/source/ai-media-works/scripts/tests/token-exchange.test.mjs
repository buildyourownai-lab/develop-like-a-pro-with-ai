import { describe, expect, it } from "vitest";
import {
  exchangeCodeForToken,
  validateTokenResponse,
  YOUTUBE_COMMENT_READ_SCOPE,
} from "../lib/token-exchange.mjs";

function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe("validateTokenResponse", () => {
  it("accepts a response with a refresh_token and the required scope", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: YOUTUBE_COMMENT_READ_SCOPE,
    });
    expect(result).toEqual({ ok: true, token: { refresh_token: "rt-1", scope: YOUTUBE_COMMENT_READ_SCOPE } });
  });

  it("rejects force-ssl mixed with any other scope (force-ssl+readonly)", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: `${YOUTUBE_COMMENT_READ_SCOPE} https://www.googleapis.com/auth/youtube.readonly`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("rejects force-ssl mixed with youtube (chapter 18's status-change scope)", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: `${YOUTUBE_COMMENT_READ_SCOPE} https://www.googleapis.com/auth/youtube`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("rejects force-ssl mixed with youtube.upload", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: `${YOUTUBE_COMMENT_READ_SCOPE} https://www.googleapis.com/auth/youtube.upload`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("rejects force-ssl mixed with openid", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: `openid ${YOUTUBE_COMMENT_READ_SCOPE}`,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("fails closed when refresh_token is missing", () => {
    const result = validateTokenResponse({ scope: YOUTUBE_COMMENT_READ_SCOPE });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_refresh_token");
  });

  it("fails closed when refresh_token is an empty string", () => {
    const result = validateTokenResponse({ refresh_token: "", scope: YOUTUBE_COMMENT_READ_SCOPE });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_refresh_token");
  });

  it("fails closed when the granted scope does not include youtube.force-ssl", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: "https://www.googleapis.com/auth/youtube.upload",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("fails closed when the granted scope is youtube.readonly — it does not authorize commentThreads.list", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: "https://www.googleapis.com/auth/youtube.readonly",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("fails closed when the granted scope is chapter 18's status-change scope (youtube) — it does not authorize commentThreads.list", () => {
    const result = validateTokenResponse({
      refresh_token: "rt-1",
      scope: "https://www.googleapis.com/auth/youtube",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("fails closed when scope is missing entirely", () => {
    const result = validateTokenResponse({ refresh_token: "rt-1" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("wrong_scope");
  });

  it("fails closed on a null body", () => {
    expect(validateTokenResponse(null).ok).toBe(false);
  });

  it("fails closed on an array body", () => {
    expect(validateTokenResponse([]).ok).toBe(false);
  });
});

describe("exchangeCodeForToken", () => {
  const params = {
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    clientId: "client-id",
    clientSecret: "client-secret",
    code: "auth-code",
    codeVerifier: "verifier",
    redirectUri: "http://127.0.0.1:51823/oauth2callback",
  };

  it("returns the validated token on a well-formed 200 response", async () => {
    const fetchImpl = fakeFetch(200, { refresh_token: "rt-1", scope: YOUTUBE_COMMENT_READ_SCOPE });
    const result = await exchangeCodeForToken(params, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("fails closed on a non-200 response", async () => {
    const fetchImpl = fakeFetch(400, { error: "invalid_grant" });
    const result = await exchangeCodeForToken(params, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_exchange_failed");
  });

  it("fails closed when the network call throws", async () => {
    const fetchImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    };
    const result = await exchangeCodeForToken(params, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("fails closed when the response body is not valid JSON", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    });
    const result = await exchangeCodeForToken(params, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_exchange_failed");
  });

  it("never includes the client secret or code in a thrown/returned message", async () => {
    const fetchImpl = fakeFetch(400, { error: "invalid_grant" });
    const result = await exchangeCodeForToken(params, fetchImpl);
    expect(JSON.stringify(result)).not.toContain(params.clientSecret);
    expect(JSON.stringify(result)).not.toContain(params.code);
  });
});
