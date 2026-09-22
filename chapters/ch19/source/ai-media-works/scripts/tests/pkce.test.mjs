import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { generateCodeChallenge, generateCodeVerifier, generateState } from "../lib/pkce.mjs";

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("PKCE helpers", () => {
  it("generates a verifier with no padding or unsafe URL characters", () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it("generates two different verifiers on successive calls", () => {
    expect(generateCodeVerifier()).not.toBe(generateCodeVerifier());
  });

  it("computes the S256 challenge as base64url(sha256(verifier))", () => {
    const verifier = "fixed-test-verifier-value-for-hash-check";
    const expected = base64Url(createHash("sha256").update(verifier).digest());
    expect(generateCodeChallenge(verifier)).toBe(expected);
  });

  it("generates a state value with no unsafe URL characters", () => {
    const state = generateState();
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates two different state values on successive calls", () => {
    expect(generateState()).not.toBe(generateState());
  });
});
