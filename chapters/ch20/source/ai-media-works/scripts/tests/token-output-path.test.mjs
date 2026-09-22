import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_TOKEN_RELATIVE_PATH, resolveTokenOutputPath } from "../lib/token-output-path.mjs";

describe("resolveTokenOutputPath", () => {
  it("resolves the default relative path inside the given project root", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ch19-project-"));
    const clientJsonPath = join(tmpdir(), "client_secret.json");

    const result = resolveTokenOutputPath({
      projectRoot,
      clientJsonPath,
      tokenOutputPath: DEFAULT_TOKEN_RELATIVE_PATH,
    });

    expect(result).toEqual({ ok: true, path: join(projectRoot, ".secrets", "youtube-comment-read-oauth.json") });
  });

  it("fails closed when the resolved token path is outside the project root via a relative traversal", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ch19-project-"));
    const clientJsonPath = join(tmpdir(), "client_secret.json");

    const result = resolveTokenOutputPath({
      projectRoot,
      clientJsonPath,
      tokenOutputPath: "../outside.json",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_path_outside_project");
  });

  it("fails closed when the token path is an absolute path outside the project root", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ch19-project-"));
    const clientJsonPath = join(tmpdir(), "client_secret.json");

    const result = resolveTokenOutputPath({
      projectRoot,
      clientJsonPath,
      tokenOutputPath: "/etc/passwd",
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_path_outside_project");
  });

  it("fails closed when the token path is the same path as the client JSON", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ch19-project-"));
    const clientJsonPath = join(projectRoot, ".secrets", "youtube-comment-read-oauth.json");

    const result = resolveTokenOutputPath({
      projectRoot,
      clientJsonPath,
      tokenOutputPath: DEFAULT_TOKEN_RELATIVE_PATH,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_path_same_as_client_json");
  });

  it("does not treat a sibling directory that merely shares a name prefix as inside the project", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ch19-project-"));
    const siblingName = `${projectRoot.split("/").pop()}-evil`;
    const clientJsonPath = join(tmpdir(), "client_secret.json");

    const result = resolveTokenOutputPath({
      projectRoot,
      clientJsonPath,
      tokenOutputPath: join("..", siblingName, "token.json"),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("token_path_outside_project");
  });
});
