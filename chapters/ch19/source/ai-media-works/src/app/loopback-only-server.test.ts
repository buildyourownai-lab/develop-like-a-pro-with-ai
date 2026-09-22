import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Next's `next dev`/`next start` default to binding 0.0.0.0 (all network
 * interfaces), which would let other devices on the reader's LAN reach this
 * server. The book promises this only ever runs on the reader's own machine,
 * so both scripts must pin the hostname to the loopback address.
 */

const PACKAGE_JSON_PATH = join(__dirname, "..", "..", "package.json");

describe("dev and start scripts bind to loopback only", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
    scripts: Record<string, string>;
  };

  it("binds `next dev` to 127.0.0.1", () => {
    expect(pkg.scripts.dev).toMatch(/--hostname\s+127\.0\.0\.1/);
  });

  it("binds `next start` to 127.0.0.1", () => {
    expect(pkg.scripts.start).toMatch(/--hostname\s+127\.0\.0\.1/);
  });

  it("never asks either script to bind every network interface", () => {
    expect(pkg.scripts.dev).not.toContain("0.0.0.0");
    expect(pkg.scripts.start).not.toContain("0.0.0.0");
  });
});
