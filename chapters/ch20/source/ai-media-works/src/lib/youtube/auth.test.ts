import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where the two OAuth credentials may come from, and what must happen when the
 * answer is unclear.
 *
 * Chapter 19 read both from files, which cannot work on a serverless
 * deployment: there is no writable filesystem to put them on and .env.local is
 * not deployed. So each credential now accepts either a path or an inline
 * value, and this suite pins the three things that makes risky —
 *
 *   - an inline value must be validated exactly as strictly as a file (same
 *     shape checks, same single-scope rule, all before any network call)
 *   - the source must never be ambiguous, so two sources for one credential is
 *     refused rather than silently resolved
 *   - no error may carry any part of a secret, because for an inline value the
 *     "input that failed to parse" IS the client secret or the refresh token
 *
 * node:fs is mocked, so nothing here touches a real file, and global.fetch is
 * mocked so nothing reaches Google. Several tests assert fetch was never called
 * at all: a credential this app refuses must be refused before the token
 * endpoint sees it.
 */

const CLIENT_JSON_PATH = "/fake/client_secret.json";
const TOKEN_PATH = "/fake/.secrets/youtube-comment-read-oauth.json";

const FORCE_SSL = "https://www.googleapis.com/auth/youtube.force-ssl";

const CLIENT_ID = "test-client-id";
const CLIENT_SECRET = "test-client-secret-value";
const REFRESH_TOKEN = "test-refresh-token-value";

const CLIENT_DOCUMENT = JSON.stringify({
  installed: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
});
const TOKEN_DOCUMENT = JSON.stringify({ refresh_token: REFRESH_TOKEN, scope: FORCE_SSL });

function base64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

function base64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

const fsState = vi.hoisted(() => ({
  files: {} as Record<string, string>,
  reads: [] as string[],
}));

vi.mock("node:fs", () => ({
  readFileSync: (path: string) => {
    fsState.reads.push(path);
    const content = fsState.files[path];
    if (content === undefined) {
      throw new Error(`ENOENT: no fake file registered for ${path}`);
    }
    return content;
  },
}));

/** Answers the one POST this module makes, and records what it was sent. */
function installTokenEndpointMock() {
  const bodies: string[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url !== "https://oauth2.googleapis.com/token") {
      throw new Error(`unexpected fetch to ${url}`);
    }
    bodies.push(String(init?.body ?? ""));
    return {
      ok: true,
      status: 200,
      json: async () => ({ access_token: "fake-access-token", expires_in: 3600 }),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, bodies };
}

const CREDENTIAL_ENV_NAMES = [
  "YOUTUBE_OAUTH_CLIENT_JSON",
  "YOUTUBE_OAUTH_CLIENT_JSON_PATH",
  "YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON",
  "YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH",
] as const;

beforeEach(() => {
  vi.resetModules();
  for (const name of CREDENTIAL_ENV_NAMES) {
    delete process.env[name];
  }
  fsState.files = { [CLIENT_JSON_PATH]: CLIENT_DOCUMENT, [TOKEN_PATH]: TOKEN_DOCUMENT };
  fsState.reads = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const name of CREDENTIAL_ENV_NAMES) {
    delete process.env[name];
  }
});

describe("credentials from inline environment values", () => {
  it("refreshes an access token from raw JSON in the environment, without reading any file", async () => {
    const { bodies } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = TOKEN_DOCUMENT;
    const { getAccessToken } = await import("./auth");

    expect(await getAccessToken()).toBe("fake-access-token");
    // The point of the inline source: a deployment with no filesystem to read.
    expect(fsState.reads).toEqual([]);

    const sent = new URLSearchParams(bodies[0]!);
    expect(sent.get("client_id")).toBe(CLIENT_ID);
    expect(sent.get("client_secret")).toBe(CLIENT_SECRET);
    expect(sent.get("refresh_token")).toBe(REFRESH_TOKEN);
    expect(sent.get("grant_type")).toBe("refresh_token");
  });

  it("accepts base64 of the same two documents", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = base64(CLIENT_DOCUMENT);
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64(TOKEN_DOCUMENT);
    const { loadClientCredentials, loadRefreshToken } = await import("./auth");

    expect(loadClientCredentials()).toEqual({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
    });
    expect(loadRefreshToken()).toBe(REFRESH_TOKEN);
    expect(fsState.reads).toEqual([]);
  });

  it("accepts the URL-safe base64 alphabet, which some encoders emit instead", async () => {
    installTokenEndpointMock();
    // A document long enough that the two alphabets actually differ.
    const padded = JSON.stringify({
      refresh_token: REFRESH_TOKEN,
      scope: FORCE_SSL,
      note: "??~~??~~",
    });
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64Url(padded);
    const { loadRefreshToken } = await import("./auth");

    expect(loadRefreshToken()).toBe(REFRESH_TOKEN);
  });

  it("accepts a base64 value wrapped across lines, as `base64` without -w0 writes it", async () => {
    installTokenEndpointMock();
    const wrapped = base64(TOKEN_DOCUMENT).replace(/(.{16})/g, "$1\n");
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = wrapped;
    const { loadRefreshToken } = await import("./auth");

    expect(loadRefreshToken()).toBe(REFRESH_TOKEN);
  });

  it("lets the two credentials use different sources — inline client, token file", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = base64(CLIENT_DOCUMENT);
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
    const { loadClientCredentials, loadRefreshToken } = await import("./auth");

    expect(loadClientCredentials().clientId).toBe(CLIENT_ID);
    expect(loadRefreshToken()).toBe(REFRESH_TOKEN);
    expect(fsState.reads).toEqual([TOKEN_PATH]);
  });

  it("treats a variable set to whitespace as absent rather than as an empty credential", async () => {
    const { fetchMock } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = "   ";
    process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH = CLIENT_JSON_PATH;
    const { loadClientCredentials } = await import("./auth");

    // Whitespace does not count as a second source, so this is not a conflict.
    expect(loadClientCredentials().clientId).toBe(CLIENT_ID);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the source of each credential is never ambiguous", () => {
  it("refuses the client credential when both an inline value and a path are set", async () => {
    const { fetchMock } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH = CLIENT_JSON_PATH;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = TOKEN_DOCUMENT;
    const { getAccessToken } = await import("./auth");
    const { YoutubeConfigMissingError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");

    let caught: unknown;
    try {
      await getAccessToken();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeConfigMissingError);
    expect(classifyYoutubeLookupError(caught)).toBe("config_missing");
    // Refused before the network, and before either source was even read: a
    // stale value must not be able to reach Google just because it was first.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fsState.reads).toEqual([]);
  });

  it("refuses the token credential when both an inline value and a path are set", async () => {
    const { fetchMock } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = TOKEN_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
    const { loadRefreshToken } = await import("./auth");
    const { YoutubeConfigMissingError } = await import("./errors");

    expect(() => loadRefreshToken()).toThrow(YoutubeConfigMissingError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("names the two colliding variables and nothing else — no value, no length", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = TOKEN_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
    const { loadRefreshToken } = await import("./auth");

    let message = "";
    try {
      loadRefreshToken();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON");
    expect(message).toContain("YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH");
    expect(message).not.toContain(REFRESH_TOKEN);
    expect(message).not.toContain(TOKEN_DOCUMENT);
    expect(message).not.toContain(String(TOKEN_DOCUMENT.length));
  });

  it("reports config_missing, naming both accepted names, when neither source is set", async () => {
    const { fetchMock } = installTokenEndpointMock();
    const { loadClientCredentials } = await import("./auth");
    const { YoutubeConfigMissingError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");

    let caught: unknown;
    try {
      loadClientCredentials();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeConfigMissingError);
    expect(classifyYoutubeLookupError(caught)).toBe("config_missing");
    expect((caught as Error).message).toContain("YOUTUBE_OAUTH_CLIENT_JSON");
    expect((caught as Error).message).toContain("YOUTUBE_OAUTH_CLIENT_JSON_PATH");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("an inline value is validated exactly as strictly as a file", () => {
  it("refuses a token value whose scope is not exactly youtube.force-ssl, before any network call", async () => {
    const { fetchMock } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64(
      JSON.stringify({
        refresh_token: REFRESH_TOKEN,
        scope: `${FORCE_SSL} https://www.googleapis.com/auth/youtube.readonly`,
      }),
    );
    const { getAccessToken } = await import("./auth");
    const { YoutubeScopeInsufficientError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");

    let caught: unknown;
    try {
      await getAccessToken();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeScopeInsufficientError);
    expect(classifyYoutubeLookupError(caught)).toBe("scope_insufficient");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an inline token value with no scope field at all", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = JSON.stringify({
      refresh_token: REFRESH_TOKEN,
    });
    const { loadRefreshToken } = await import("./auth");
    const { YoutubeScopeInsufficientError } = await import("./errors");

    expect(() => loadRefreshToken()).toThrow(YoutubeScopeInsufficientError);
  });

  it("refuses an inline token value whose scopes array holds a non-string entry", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = JSON.stringify({
      refresh_token: REFRESH_TOKEN,
      scopes: [FORCE_SSL, 42],
    });
    const { loadRefreshToken } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");

    expect(() => loadRefreshToken()).toThrow(YoutubeCredentialFileError);
    expect(() => loadRefreshToken()).toThrow(/scopes 배열/);
  });

  it("refuses an inline token value with no refresh_token", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64(
      JSON.stringify({ scope: FORCE_SSL }),
    );
    const { loadRefreshToken } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");

    expect(() => loadRefreshToken()).toThrow(YoutubeCredentialFileError);
    expect(() => loadRefreshToken()).toThrow(/refresh_token/);
  });

  it("refuses an inline client value that is not a Desktop (installed) client", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = JSON.stringify({
      web: { client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    });
    const { loadClientCredentials } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");

    expect(() => loadClientCredentials()).toThrow(YoutubeCredentialFileError);
    expect(() => loadClientCredentials()).toThrow(/installed/);
  });

  it("refuses an inline client value whose top level is a JSON array", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = base64(JSON.stringify([{ client_id: CLIENT_ID }]));
    const { loadClientCredentials } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");

    expect(() => loadClientCredentials()).toThrow(/형식이 올바르지 않습니다/);
    expect(() => loadClientCredentials()).toThrow(YoutubeCredentialFileError);
  });

  it("refuses a value that is neither a JSON object nor base64", async () => {
    const { fetchMock } = installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = "client_id=abc client_secret=def";
    const { loadClientCredentials } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");
    const { classifyYoutubeLookupError } = await import("./error-classification");

    let caught: unknown;
    try {
      loadClientCredentials();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(YoutubeCredentialFileError);
    expect(classifyYoutubeLookupError(caught)).toBe("credential_file_invalid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses base64 of something that is not JSON", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64("just a sentence");
    const { loadRefreshToken } = await import("./auth");
    const { YoutubeCredentialFileError } = await import("./errors");

    expect(() => loadRefreshToken()).toThrow(YoutubeCredentialFileError);
  });
});

describe("no error carries any part of a secret", () => {
  /**
   * The specific hazard: JSON.parse quotes the text it choked on. If a wrapped
   * message ever re-threw that, a truncated client secret or refresh token
   * would land in the deployment's log — which is exactly the place a secret
   * pasted into an environment variable is most likely to be read by somebody
   * who should not have it.
   */
  it("keeps a malformed inline value out of the thrown message", async () => {
    installTokenEndpointMock();
    // Valid base64, decodes to something JSON.parse rejects mid-way, and the
    // secret-looking text sits exactly where a parser would quote it.
    const nearlyJson = `{"refresh_token": "${REFRESH_TOKEN}", "scope"`;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = base64(nearlyJson);
    const { loadRefreshToken } = await import("./auth");

    let message = "";
    try {
      loadRefreshToken();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(REFRESH_TOKEN);
    expect(message).not.toContain(nearlyJson);
    expect(message).not.toContain(base64(nearlyJson));
    expect(message).toBe("댓글 Token JSON을 읽거나 파싱할 수 없습니다.");
  });

  it("keeps the client secret out of the thrown message when the client value is malformed", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = `{"installed": {"client_secret": "${CLIENT_SECRET}"`;
    const { loadClientCredentials } = await import("./auth");

    let message = "";
    try {
      loadClientCredentials();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain(CLIENT_SECRET);
    expect(message).toBe("OAuth client JSON을 읽거나 파싱할 수 없습니다.");
  });

  it("never puts a secret in the fixed message the browser is allowed to see", async () => {
    installTokenEndpointMock();
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = `{"installed": {"client_secret": "${CLIENT_SECRET}"`;
    const { loadClientCredentials } = await import("./auth");
    const { classifyYoutubeLookupError, YOUTUBE_LOOKUP_ERROR_MESSAGE } = await import(
      "./error-classification"
    );

    let caught: unknown;
    try {
      loadClientCredentials();
    } catch (error) {
      caught = error;
    }
    const safeMessage = YOUTUBE_LOOKUP_ERROR_MESSAGE[classifyYoutubeLookupError(caught)];
    expect(safeMessage).not.toContain(CLIENT_SECRET);
    expect(safeMessage).not.toContain("YOUTUBE_OAUTH_CLIENT_JSON");
  });
});

describe("hasYoutubeCredentialConfig", () => {
  it("is false until both credentials have a source", async () => {
    const { hasYoutubeCredentialConfig } = await import("./auth");

    expect(hasYoutubeCredentialConfig()).toBe(false);

    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    expect(hasYoutubeCredentialConfig()).toBe(false);

    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
    expect(hasYoutubeCredentialConfig()).toBe(true);
  });

  it("is true for the local file setup and for the inline setup alike", async () => {
    const { hasYoutubeCredentialConfig } = await import("./auth");

    process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH = CLIENT_JSON_PATH;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH = TOKEN_PATH;
    expect(hasYoutubeCredentialConfig()).toBe(true);

    delete process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH;
    delete process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH;
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = CLIENT_DOCUMENT;
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = TOKEN_DOCUMENT;
    expect(hasYoutubeCredentialConfig()).toBe(true);
  });

  it("reads nothing and decodes nothing — presence only", async () => {
    const { hasYoutubeCredentialConfig } = await import("./auth");

    // Values that would fail every validation still count as "a source is set":
    // the loaders refuse them, and this helper only answers whether the names
    // are filled in.
    process.env.YOUTUBE_OAUTH_CLIENT_JSON = "not a credential";
    process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON = "also not";
    expect(hasYoutubeCredentialConfig()).toBe(true);
    expect(fsState.reads).toEqual([]);
  });
});
