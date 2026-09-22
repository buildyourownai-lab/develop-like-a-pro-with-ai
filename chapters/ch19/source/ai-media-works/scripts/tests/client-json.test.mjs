import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOAuthClient } from "../lib/client-json.mjs";

function tempFile(name, content) {
  const dir = mkdtempSync(join(tmpdir(), "ch19-oauth-test-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

describe("loadOAuthClient", () => {
  it("reads client_id/client_secret from a Desktop app 'installed' client JSON", () => {
    const path = tempFile(
      "client_secret.json",
      JSON.stringify({ installed: { client_id: "id-1", client_secret: "secret-1" } }),
    );
    expect(loadOAuthClient(path)).toEqual({ clientId: "id-1", clientSecret: "secret-1" });
  });

  it("rejects a 'web' client JSON shape — this app only supports the Desktop (installed) type", () => {
    const path = tempFile(
      "client_secret.json",
      JSON.stringify({ web: { client_id: "id-2", client_secret: "secret-2" } }),
    );
    expect(() => loadOAuthClient(path)).toThrow(/installed/);
  });

  it("rejects a flat client JSON with no 'installed' wrapper", () => {
    const path = tempFile(
      "client_secret.json",
      JSON.stringify({ client_id: "id-3", client_secret: "secret-3" }),
    );
    expect(() => loadOAuthClient(path)).toThrow(/installed/);
  });

  it("rejects a client JSON whose top-level value is an array", () => {
    const path = tempFile("client_secret.json", JSON.stringify([{ client_id: "id-4" }]));
    expect(() => loadOAuthClient(path)).toThrow(/형식이 올바르지 않습니다/);
  });

  it("throws for a file that does not exist", () => {
    expect(() => loadOAuthClient("/no/such/file.json")).toThrow(/읽을 수 없습니다/);
  });

  it("throws for malformed JSON", () => {
    const path = tempFile("client_secret.json", "not json");
    expect(() => loadOAuthClient(path)).toThrow(/올바른 JSON/);
  });

  it("throws when client_id or client_secret is missing", () => {
    const path = tempFile("client_secret.json", JSON.stringify({ installed: { client_id: "id-1" } }));
    expect(() => loadOAuthClient(path)).toThrow(/client_id\/client_secret/);
  });
});
