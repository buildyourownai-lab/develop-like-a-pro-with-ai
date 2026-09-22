import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_FAILURE_MESSAGE,
  authorizeOperatorRequest,
  authorizeSchedulerRequest,
} from "./request-auth";

/**
 * Who gets in. The endpoint that matters most here is the scheduled run: it can
 * publish a real reply and nobody is watching it happen, so it must be
 * unreachable unless the caller proves it holds the secret.
 */

const SECRET = "scheduler-secret-value";
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

/**
 * Written through a cast because some type declarations describe NODE_ENV as a
 * read-only union. The value is restored after every test.
 */
function setNodeEnv(value: string | undefined): void {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

function requestWith(authorization?: string): Request {
  return new Request("http://localhost/api/auto-reply/run", {
    method: "POST",
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });
}

beforeEach(() => {
  delete process.env.AUTO_REPLY_SCHEDULER_SECRET;
  delete process.env.AUTO_REPLY_OPERATOR_SECRET;
});

afterEach(() => {
  setNodeEnv(ORIGINAL_NODE_ENV);
  delete process.env.AUTO_REPLY_SCHEDULER_SECRET;
  delete process.env.AUTO_REPLY_OPERATOR_SECRET;
});

describe("the scheduled run endpoint", () => {
  it("refuses every request when no secret is configured, even outside production", () => {
    setNodeEnv("development");

    const result = authorizeSchedulerRequest(requestWith(`Bearer ${SECRET}`));

    // 503, and no way to make it 200: an endpoint that can send a reply is
    // never open just because the server was started locally.
    expect(result).toEqual({ authorized: false, reason: "secret_not_configured", status: 503 });
  });

  it("refuses a request with no Authorization header", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;

    expect(authorizeSchedulerRequest(requestWith())).toEqual({
      authorized: false,
      reason: "missing_credentials",
      status: 401,
    });
  });

  it("refuses a secret sent as a query parameter instead of a header", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;
    const request = new Request(`http://localhost/api/auto-reply/run?secret=${SECRET}`, {
      method: "POST",
    });

    // The URL is the one place a secret must never be, because it is logged.
    expect(authorizeSchedulerRequest(request)).toMatchObject({
      authorized: false,
      reason: "missing_credentials",
    });
  });

  it("refuses a wrong secret, a shorter one, and a longer one", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;

    for (const attempt of [`Bearer ${SECRET}x`, "Bearer scheduler", `Bearer ${SECRET.toUpperCase()}`]) {
      expect(authorizeSchedulerRequest(requestWith(attempt))).toEqual({
        authorized: false,
        reason: "invalid_credentials",
        status: 401,
      });
    }
  });

  it("refuses a bare token that is not a Bearer credential", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;

    expect(authorizeSchedulerRequest(requestWith(SECRET))).toMatchObject({
      reason: "missing_credentials",
    });
    expect(authorizeSchedulerRequest(requestWith(`Basic ${SECRET}`))).toMatchObject({
      reason: "missing_credentials",
    });
  });

  it("accepts the exact secret in a Bearer header", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;

    expect(authorizeSchedulerRequest(requestWith(`Bearer ${SECRET}`))).toEqual({ authorized: true });
  });
});

describe("the operator endpoints", () => {
  it("are open locally while no operator secret is set, so the chapter can be followed without one", () => {
    setNodeEnv("development");

    expect(authorizeOperatorRequest(requestWith())).toEqual({ authorized: true });
  });

  it("are closed in production when no operator secret is set", () => {
    setNodeEnv("production");

    expect(authorizeOperatorRequest(requestWith())).toEqual({
      authorized: false,
      reason: "secret_not_configured",
      status: 503,
    });
  });

  it("start enforcing the moment a secret is set, even locally", () => {
    setNodeEnv("development");
    process.env.AUTO_REPLY_OPERATOR_SECRET = "operator-secret";

    expect(authorizeOperatorRequest(requestWith())).toMatchObject({ reason: "missing_credentials" });
    expect(authorizeOperatorRequest(requestWith("Bearer nope"))).toMatchObject({
      reason: "invalid_credentials",
    });
    expect(authorizeOperatorRequest(requestWith("Bearer operator-secret"))).toEqual({
      authorized: true,
    });
  });

  it("does not accept the scheduler's secret", () => {
    setNodeEnv("production");
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;
    process.env.AUTO_REPLY_OPERATOR_SECRET = "operator-secret";

    expect(authorizeOperatorRequest(requestWith(`Bearer ${SECRET}`))).toMatchObject({
      reason: "invalid_credentials",
    });
  });
});

describe("what a refused caller is told", () => {
  it("gets a fixed message that never repeats the secret or says how it was wrong", () => {
    process.env.AUTO_REPLY_SCHEDULER_SECRET = SECRET;
    const result = authorizeSchedulerRequest(requestWith("Bearer scheduler-secret-valu"));

    expect(result.authorized).toBe(false);
    if (result.authorized) return;
    const message = AUTH_FAILURE_MESSAGE[result.reason];
    expect(message).toBe("실행 열쇠가 맞지 않습니다.");
    expect(message).not.toContain(SECRET);
    expect(message).not.toContain("AUTO_REPLY_SCHEDULER_SECRET");
    // Same message for any mismatch, so a caller cannot narrow the secret down
    // by comparing answers.
    expect(AUTH_FAILURE_MESSAGE[result.reason]).toBe(AUTH_FAILURE_MESSAGE.invalid_credentials);
  });
});
