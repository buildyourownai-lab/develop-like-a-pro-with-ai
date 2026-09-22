import { describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveTokenFile } from "../lib/secure-store.mjs";

const isRoot = typeof process.getuid === "function" && process.getuid() === 0;

describe("saveTokenFile", () => {
  it("writes the given data as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const path = join(dir, "token.json");

    saveTokenFile(path, { refresh_token: "rt-1", scope: "youtube.force-ssl" });

    const written = JSON.parse(readFileSync(path, "utf8"));
    expect(written).toEqual({ refresh_token: "rt-1", scope: "youtube.force-ssl" });
  });

  it("creates missing parent directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const path = join(dir, "nested", "secrets", "token.json");

    saveTokenFile(path, { refresh_token: "rt-1" });

    expect(readFileSync(path, "utf8")).toContain("rt-1");
  });

  it("restricts the file to owner-only read/write (0o600)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const path = join(dir, "token.json");

    saveTokenFile(path, { refresh_token: "rt-1" });

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("replaces an existing token file atomically and leaves no temp file behind", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const path = join(dir, "token.json");

    saveTokenFile(path, { refresh_token: "old-token" });
    saveTokenFile(path, { refresh_token: "new-token" });

    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ refresh_token: "new-token" });
    const entries = readdirSync(dir);
    expect(entries).toEqual(["token.json"]);
  });

  it.skipIf(isRoot)("leaves no temp file behind when the write fails (target directory not writable)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const readonlyDir = join(dir, "readonly");
    mkdirSync(readonlyDir);
    chmodSync(readonlyDir, 0o500);
    const path = join(readonlyDir, "token.json");

    try {
      expect(() => saveTokenFile(path, { refresh_token: "rt-1" })).toThrow();
      expect(readdirSync(readonlyDir)).toEqual([]);
    } finally {
      chmodSync(readonlyDir, 0o700);
    }
  });

  it("never logs the token contents to the console", () => {
    const dir = mkdtempSync(join(tmpdir(), "ch19-token-test-"));
    const path = join(dir, "token.json");
    const logSpy = [];
    const originalLog = console.log;
    console.log = (...args) => logSpy.push(args);

    try {
      saveTokenFile(path, { refresh_token: "super-secret-value" });
    } finally {
      console.log = originalLog;
    }

    expect(logSpy.flat().join(" ")).not.toContain("super-secret-value");
  });
});
