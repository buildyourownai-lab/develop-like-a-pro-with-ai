import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";

/**
 * Saves the comment-read OAuth token as owner-only (0o600). This file is
 * separate from chapter 18's upload token file and from any .env — it is
 * covered by .gitignore's `.secrets/` and `*token*.json` patterns.
 *
 * Writes to a temp file in the same directory first, then renames it over
 * the target — an existing file (e.g. a previous comment-read token) is only
 * ever replaced by a fully-written, already-validated new token, never left
 * half-written. The temp file is removed on any failure so nothing lingers.
 */
export function saveTokenFile(path, data) {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tempPath, 0o600);
    renameSync(tempPath, path);
  } catch (error) {
    try {
      rmSync(tempPath, { force: true });
    } catch {
      // best-effort cleanup only
    }
    throw error;
  }
}
