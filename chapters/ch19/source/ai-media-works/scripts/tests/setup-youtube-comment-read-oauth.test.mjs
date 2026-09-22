import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAuthUrl, run } from "../setup-youtube-comment-read-oauth.mjs";

/**
 * These tests exercise `run()` only up to the point where it would start a
 * real network call to Google — every scenario here fails closed (a bad
 * token path, or a port conflict) before any OAuth request would ever be
 * made, so no real OAuth/API traffic happens.
 */

const CALLBACK_PORT = 51823;

function tempClientJson() {
  const dir = mkdtempSync(join(tmpdir(), "ch19-setup-test-"));
  const path = join(dir, "client_secret.json");
  writeFileSync(path, JSON.stringify({ installed: { client_id: "id", client_secret: "secret" } }));
  return path;
}

function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {});
    server.once("listening", () => resolve(server));
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
  });
}

let occupiedServer = null;

afterEach(async () => {
  if (occupiedServer) {
    await new Promise((resolve) => occupiedServer.close(resolve));
    occupiedServer = null;
  }
});

describe("run — token output path is restricted before any OAuth flow starts", () => {
  it("fails closed without printing anything when tokenOutputPath resolves outside the project", async () => {
    const clientJsonPath = tempClientJson();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const outcome = await run({ clientJsonPath, tokenOutputPath: "/tmp/ch19-outside-token.json" });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("token_path_outside_project");
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("run — the consent URL is only printed once the callback server is actually listening", () => {
  it("fails closed immediately (does not hang) and never prints the consent URL when the callback port is busy", async () => {
    occupiedServer = await occupyPort(CALLBACK_PORT);
    const clientJsonPath = tempClientJson();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const outcome = await run({ clientJsonPath });

      expect(outcome.ok).toBe(false);
      expect(outcome.reason).toBe("server_error");
      const printed = logSpy.mock.calls.flat().join(" ");
      expect(printed).not.toContain("accounts.google.com");
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("run — the authorization URL requests exactly youtube.force-ssl alone", () => {
  it("buildAuthUrl requests exactly one scope (youtube.force-ssl) in the URL", () => {
    const authUrl = buildAuthUrl({
      clientId: "test-client-id",
      state: "test-state",
      codeChallenge: "test-challenge",
    });
    const url = new URL(authUrl);
    const scope = url.searchParams.get("scope");
    expect(scope).toBe("https://www.googleapis.com/auth/youtube.force-ssl");
  });
});
