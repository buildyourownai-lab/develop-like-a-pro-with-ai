import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * A static guard on how much of YouTube this project can touch.
 *
 * Chapter 19 could make this promise the easy way: it had no write call at all,
 * so a test that forbade every write method was enough. Chapter 20 needs one
 * write call, and "one" is a much weaker promise than "none" unless something
 * keeps checking. So this file replaces the old all-or-nothing test with a
 * boundary:
 *
 *   - comments.insert is the ONLY write method, and it is reachable from ONE
 *     file (src/lib/youtube/reply-client.ts) through ONE transport helper
 *     (authedPost in src/lib/youtube/api.ts)
 *   - no other YouTube write exists anywhere: no comment edit, delete,
 *     moderation, or spam marking, no thread insert, no video update, delete,
 *     or rating
 *   - the features this chapter deliberately leaves out stay out
 *
 * These are source-text checks, read directly rather than executed, because a
 * test that had to run the code would need the network to prove a negative.
 */

function listFilesRecursively(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      return listFilesRecursively(fullPath);
    }
    return statSync(fullPath).isFile() ? [fullPath] : [];
  });
}

const SRC_DIR = join(__dirname, "..");
const PRODUCT_SOURCE_FILES = listFilesRecursively(SRC_DIR)
  .filter((path) => path.endsWith(".ts") || path.endsWith(".tsx"))
  .filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".test.tsx"))
  // Fakes exist to keep tests off the network; they are not shipped behaviour.
  .filter((path) => !path.split(sep).includes("__fixtures__"));

function repoPath(path: string): string {
  return relative(SRC_DIR, path).split(sep).join("/");
}

/** The single file allowed to build a write request to YouTube. */
const WRITE_CLIENT = "lib/youtube/reply-client.ts";
/** The single file allowed to actually issue an authenticated POST. */
const TRANSPORT = "lib/youtube/api.ts";

const FORBIDDEN_WRITE_PATTERNS = [
  /comments\.update\s*\(/i,
  /comments\.delete\s*\(/i,
  /comments\.setModerationStatus\s*\(/i,
  /comments\.markAsSpam\s*\(/i,
  /commentThreads\.insert\s*\(/i,
  /videos\.update\s*\(/i,
  /videos\.delete\s*\(/i,
  /videos\.insert\s*\(/i,
  /videos\.rate\s*\(/i,
  /playlistItems\.insert\s*\(/i,
  /channels\.update\s*\(/i,
  // The REST paths those methods use, in case a call is spelled out by hand.
  /["'`]\/comments\/markAsSpam/i,
  /["'`]\/comments\/setModerationStatus/i,
  /["'`]\/commentThreads["'`]\s*,\s*\{[^}]*POST/i,
];

const EXCLUDED_FEATURE_HINTS = [
  "google-chat",
  "googleapis.com/chat",
  "/queue/",
  "/worker/",
  "representative-office",
  "sign-up",
  "signup",
  "analyticsreporting",
  "youtubeanalytics",
];

describe("chapter 20 write surface is exactly one call in one file", () => {
  it("issues an authenticated POST from the transport helper only", () => {
    const offenders = PRODUCT_SOURCE_FILES.filter((path) => {
      if (repoPath(path) === TRANSPORT) return false;
      const content = readFileSync(path, "utf8");
      // A POST built against the YouTube API base anywhere else would be a
      // second write path that bypasses reply-client.ts entirely.
      return (
        content.includes("YOUTUBE_API_BASE") && /method\s*:\s*["']POST["']/.test(content)
      );
    });
    expect(offenders.map(repoPath)).toEqual([]);
  });

  it("uses authedPost from the reply client only", () => {
    const users = PRODUCT_SOURCE_FILES.filter((path) => {
      if (repoPath(path) === TRANSPORT) return false;
      return readFileSync(path, "utf8").includes("authedPost");
    });
    expect(users.map(repoPath)).toEqual([WRITE_CLIENT]);
  });

  it("calls the comments.insert endpoint from the reply client only", () => {
    const writers = PRODUCT_SOURCE_FILES.filter((path) => {
      const content = readFileSync(path, "utf8");
      return /authedPost\s*\(\s*["'`]\/comments["'`]/.test(content);
    });
    expect(writers.map(repoPath)).toEqual([WRITE_CLIENT]);
  });

  it("sends only a parent id and the reply text in that one write body", () => {
    const content = readFileSync(join(SRC_DIR, WRITE_CLIENT), "utf8");
    // The assertion is on the write call itself, not the whole file: the same
    // file also READS authorChannelId back off comments.list to recognize its
    // own reply, and that read must not be confused with putting a channel id
    // into a write.
    const writeCall = content.match(/authedPost\([\s\S]*?\n {4}\);/)?.[0] ?? "";
    expect(writeCall).toContain('"/comments"');
    expect(writeCall).toContain('{ part: "snippet" }');
    expect(writeCall).toContain("snippet: { parentId: input.parentCommentId, textOriginal: input.text }");
    // No moderation status and no author impersonation in the body.
    expect(writeCall).not.toMatch(/moderationStatus/i);
    expect(writeCall).not.toMatch(/authorChannelId/);
    // And no moderation field anywhere in the write client either.
    expect(content).not.toMatch(/moderationStatus/i);
  });

  it("has no other YouTube write method anywhere in the product source", () => {
    for (const path of PRODUCT_SOURCE_FILES) {
      const content = readFileSync(path, "utf8");
      for (const pattern of FORBIDDEN_WRITE_PATTERNS) {
        expect(content, `${repoPath(path)} matched forbidden write ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the excluded features out", () => {
    for (const path of PRODUCT_SOURCE_FILES) {
      const lowerPath = path.toLowerCase();
      const lowerContent = readFileSync(path, "utf8").toLowerCase();
      for (const hint of EXCLUDED_FEATURE_HINTS) {
        expect(lowerPath, `${repoPath(path)} path mentions ${hint}`).not.toContain(hint);
        expect(lowerContent, `${repoPath(path)} content mentions ${hint}`).not.toContain(hint);
      }
    }
  });

  it("has exactly the API routes these two chapters need", () => {
    const apiDir = join(SRC_DIR, "app", "api");
    const routeDirs = readdirSync(apiDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // comments / review / video are chapter 19's local preview routes.
    expect(routeDirs).toEqual(["auto-reply", "comments", "review", "video"]);

    const autoReplyDirs = readdirSync(join(apiDir, "auto-reply"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    // The boundaries plus status, and nothing that edits or deletes. prepare is
    // the first half of a person's approval: it returns the draft to show and
    // signs it, and it may store the target row the first time a video is used —
    // but the checks above prove it cannot reach comments.insert.
    expect(autoReplyDirs).toEqual(["enable", "prepare", "run", "send", "status", "stop", "target"]);
  });

  it("keeps the state store behind one adapter", () => {
    // Only the adapter reads the store's address and key, so there is exactly
    // one place a request to the database can be built — and exactly one place
    // to look when asking where the service role key goes.
    const credentialReaders = PRODUCT_SOURCE_FILES.filter((path) =>
      /process\.env\.SUPABASE_/.test(readFileSync(path, "utf8")),
    ).map(repoPath);
    expect(credentialReaders).toEqual(["lib/autoreply/supabase-store.ts"]);

    // And only the wiring file builds it, so a route or the runner cannot
    // quietly acquire a second store.
    const builders = PRODUCT_SOURCE_FILES.filter((path) =>
      readFileSync(path, "utf8").includes("createSupabaseAutoReplyStore("),
    ).map(repoPath);
    expect(builders.sort()).toEqual([
      "lib/autoreply/real-deps.ts",
      "lib/autoreply/supabase-store.ts",
    ]);
  });
});
