import { describe, expect, it } from "vitest";
import { parseCallbackRequest } from "../lib/oauth-callback.mjs";

const STATE = "expected-state-value";

describe("parseCallbackRequest", () => {
  it("accepts a matching state with a code", () => {
    const result = parseCallbackRequest(`/oauth2callback?code=abc123&state=${STATE}`, STATE);
    expect(result).toEqual({ ok: true, code: "abc123" });
  });

  it("fails closed on a state mismatch instead of accepting the code anyway", () => {
    const result = parseCallbackRequest("/oauth2callback?code=abc123&state=wrong", STATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("state_mismatch");
  });

  it("treats a missing state as a mismatch", () => {
    const result = parseCallbackRequest("/oauth2callback?code=abc123", STATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("state_mismatch");
  });

  it("classifies access_denied as a user cancellation", () => {
    const result = parseCallbackRequest(`/oauth2callback?error=access_denied&state=${STATE}`, STATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("cancelled");
  });

  it("classifies any other provider error distinctly from cancellation", () => {
    const result = parseCallbackRequest(`/oauth2callback?error=server_error&state=${STATE}`, STATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("provider_error");
  });

  it("checks the error parameter before the state, since Google omits state on some errors", () => {
    const result = parseCallbackRequest("/oauth2callback?error=access_denied", STATE);
    expect(result.reason).toBe("cancelled");
  });

  it("fails closed when the code is missing even with a matching state", () => {
    const result = parseCallbackRequest(`/oauth2callback?state=${STATE}`, STATE);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_code");
  });

  it("fails closed on a malformed request URL", () => {
    const result = parseCallbackRequest("::::not a url", STATE);
    expect(result.ok).toBe(false);
  });

  it("fails closed when no expected state was ever configured", () => {
    const result = parseCallbackRequest(`/oauth2callback?code=abc123&state=${STATE}`, undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_expected_state");
  });
});
