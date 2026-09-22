import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { startCallbackServer } from "../lib/callback-server.mjs";

const STATE = "test-state-value";
let extraServers = [];

afterEach(async () => {
  await Promise.all(
    extraServers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
  extraServers = [];
});

function occupyPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer(() => {});
    server.once("listening", () => resolve(server));
    server.once("error", reject);
    server.listen(port, "127.0.0.1");
    extraServers.push(server);
  });
}

describe("startCallbackServer", () => {
  it("resolves ok with the code when a valid callback arrives", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    const readyOutcome = await callback.ready;
    expect(readyOutcome).toEqual({ ok: true });
    const { port } = callback.address();

    const response = await fetch(`http://127.0.0.1:${port}/oauth2callback?code=abc123&state=${STATE}`);
    expect(response.status).toBe(200);

    const outcome = await callback.result;
    expect(outcome).toEqual({ ok: true, code: "abc123" });
  });

  it("responds with plain text and never reflects the callback URL or provider error back into the page", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    await callback.ready;
    const { port } = callback.address();

    const injected = "<script>alert(1)</script>";
    const response = await fetch(
      `http://127.0.0.1:${port}/oauth2callback?error=${encodeURIComponent(injected)}&state=${STATE}`,
    );
    const text = await response.text();

    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(text).not.toContain("<script>");
    expect(text).not.toContain(injected);
    expect(text).not.toContain("<p>");

    const outcome = await callback.result;
    expect(outcome.reason).toBe("provider_error");
  });

  it("never logs the incoming callback URL or the authorization code to the console", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    await callback.ready;
    const { port } = callback.address();

    const logSpy = [];
    const originalLog = console.log;
    const originalError = console.error;
    console.log = (...args) => logSpy.push(args);
    console.error = (...args) => logSpy.push(args);

    try {
      await fetch(`http://127.0.0.1:${port}/oauth2callback?code=super-secret-code&state=${STATE}`);
      await callback.result;
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    expect(logSpy.flat().join(" ")).not.toContain("super-secret-code");
  });

  it("fails closed on a state mismatch", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    await callback.ready;
    const { port } = callback.address();

    await fetch(`http://127.0.0.1:${port}/oauth2callback?code=abc123&state=wrong`);
    const outcome = await callback.result;

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("state_mismatch");
  });

  it("classifies a cancelled consent screen", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    await callback.ready;
    const { port } = callback.address();

    await fetch(`http://127.0.0.1:${port}/oauth2callback?error=access_denied&state=${STATE}`);
    const outcome = await callback.result;

    expect(outcome.reason).toBe("cancelled");
  });

  it("resolves cancelled when cancel() is called externally (e.g. SIGINT)", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    await callback.ready;

    callback.cancel();
    const outcome = await callback.result;

    expect(outcome).toEqual({ ok: false, reason: "cancelled", message: "사용자가 취소했습니다." });
  });

  it("times out when no callback ever arrives", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 20 });
    const outcome = await callback.result;

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("timeout");
  });

  it("fails closed with a clear message when the port is already in use", async () => {
    const occupied = await occupyPort(0);
    const port = occupied.address().port;

    const callback = startCallbackServer({ port, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    const outcome = await callback.result;

    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe("server_error");
    expect(outcome.message).toContain(String(port));
  });

  it("settles `ready` immediately with a fail-closed outcome on a port conflict, instead of hanging forever", async () => {
    const occupied = await occupyPort(0);
    const port = occupied.address().port;

    const callback = startCallbackServer({ port, path: "/oauth2callback", expectedState: STATE, timeoutMs: 5000 });
    const readyOutcome = await callback.ready;

    expect(readyOutcome.ok).toBe(false);
    expect(readyOutcome.reason).toBe("server_error");
  });

  it("ignores requests to an unrelated path instead of treating them as the callback", async () => {
    const callback = startCallbackServer({ port: 0, path: "/oauth2callback", expectedState: STATE, timeoutMs: 300 });
    await callback.ready;
    const { port } = callback.address();

    const response = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    expect(response.status).toBe(404);

    const outcome = await callback.result;
    expect(outcome.reason).toBe("timeout");
  });
});
