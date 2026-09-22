import { describe, expect, it } from "vitest";
import { YoutubeSchemaError } from "./schema";
import { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } from "./error-classification";
import {
  YoutubeAuthError,
  YoutubeConfigMissingError,
  YoutubeCredentialFileError,
  YoutubeQuotaExceededError,
  YoutubeScopeInsufficientError,
} from "./errors";

describe("classifyYoutubeLookupError", () => {
  it("classifies a YoutubeSchemaError as invalid_response", () => {
    expect(classifyYoutubeLookupError(new YoutubeSchemaError("bad shape"))).toBe("invalid_response");
  });

  it("classifies an unset-env-var config error as config_missing", () => {
    expect(
      classifyYoutubeLookupError(new Error("YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH is not set on the server.")),
    ).toBe("config_missing");
  });

  it("classifies a typed YoutubeConfigMissingError as config_missing, by type not message", () => {
    const secretPath = "/Users/someone/.env.local";
    expect(classifyYoutubeLookupError(new YoutubeConfigMissingError(`unset near ${secretPath}`))).toBe(
      "config_missing",
    );
  });

  it("classifies a typed YoutubeCredentialFileError as credential_file_invalid, by type not message", () => {
    const secretPath = "/Users/someone/.secrets/client_secret.json";
    expect(
      classifyYoutubeLookupError(new YoutubeCredentialFileError(`cannot parse ${secretPath}`)),
    ).toBe("credential_file_invalid");
  });

  it("classifies a typed YoutubeScopeInsufficientError as scope_insufficient, by type not message", () => {
    expect(classifyYoutubeLookupError(new YoutubeScopeInsufficientError("missing scope"))).toBe(
      "scope_insufficient",
    );
  });

  it("classifies a typed YoutubeAuthError as auth_error", () => {
    expect(classifyYoutubeLookupError(new YoutubeAuthError("token invalid"))).toBe("auth_error");
  });

  it("classifies a typed YoutubeQuotaExceededError as quota_exceeded", () => {
    expect(classifyYoutubeLookupError(new YoutubeQuotaExceededError("over quota"))).toBe("quota_exceeded");
  });

  it("classifies a 429 lookup failure as quota_exceeded", () => {
    expect(classifyYoutubeLookupError(new Error("channels.list failed with status 429"))).toBe(
      "quota_exceeded",
    );
  });

  it("classifies a 401 lookup failure as auth_error", () => {
    expect(classifyYoutubeLookupError(new Error("channels.list failed with status 401"))).toBe("auth_error");
  });

  it("classifies a 403 lookup failure as auth_error", () => {
    expect(classifyYoutubeLookupError(new Error("videos.list failed with status 403"))).toBe("auth_error");
  });

  it("classifies a thrown TypeError (fetch network failure) as network_error", () => {
    expect(classifyYoutubeLookupError(new TypeError("fetch failed"))).toBe("network_error");
  });

  it("classifies an unrecognized error as the generic lookup_failed", () => {
    expect(classifyYoutubeLookupError(new Error("videos.list failed with status 500"))).toBe("lookup_failed");
  });

  it("classifies a non-Error thrown value as the generic lookup_failed", () => {
    expect(classifyYoutubeLookupError("not an error")).toBe("lookup_failed");
  });

  it("never needs the original message — the reason alone is safe to forward", () => {
    const secretPath = "/Users/someone/.secrets/youtube-comment-read-oauth.json";
    const reason = classifyYoutubeLookupError(new Error(`ENOENT reading ${secretPath}`));
    expect(typeof reason).toBe("string");
    expect(reason).not.toContain(secretPath);
  });

  it("never carries a raw file path in a typed credential/config/scope error's fixed browser message", () => {
    const clientJsonPath = "/Users/someone/.secrets/client_secret_1234.json";
    const tokenPath = "/Users/someone/.secrets/youtube-comment-read-oauth.json";

    const configReason = classifyYoutubeLookupError(
      new YoutubeConfigMissingError(`YOUTUBE_OAUTH_CLIENT_JSON_PATH is not set (checked ${clientJsonPath})`),
    );
    const fileReason = classifyYoutubeLookupError(
      new YoutubeCredentialFileError(`cannot parse ${tokenPath}`),
    );
    const scopeReason = classifyYoutubeLookupError(
      new YoutubeScopeInsufficientError(`token at ${tokenPath} lacks scope`),
    );

    for (const reason of [configReason, fileReason, scopeReason]) {
      const message = YOUTUBE_LOOKUP_ERROR_MESSAGE[reason];
      expect(message).not.toContain(clientJsonPath);
      expect(message).not.toContain(tokenPath);
      expect(message).not.toMatch(/\.json/);
      expect(message).not.toMatch(/\/Users\//);
    }
  });
});
