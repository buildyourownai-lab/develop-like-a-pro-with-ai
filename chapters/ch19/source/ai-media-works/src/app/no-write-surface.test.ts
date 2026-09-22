import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A static guard, not a live check: this chapter must ship with no path
 * that could send a reply, change a video's privacy, or talk to Google Chat,
 * a queue, or a worker. If any of those come back, this test should fail
 * loudly rather than let them slip back into the ch19 tree unnoticed.
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
const ALL_SOURCE_FILES = listFilesRecursively(SRC_DIR).filter(
  (path) => path.endsWith(".ts") || path.endsWith(".tsx"),
);

const FORBIDDEN_PATH_HINTS = [
  "google-chat",
  "/queue/",
  "/worker/",
  "representative-office",
  "signup",
  "sign-up",
];

const FORBIDDEN_CONTENT_PATTERNS = [
  /comments\.insert\s*\(/i,
  /comments\.update\s*\(/i,
  /comments\.delete\s*\(/i,
  /comments\.setModerationStatus\s*\(/i,
  /comments\.markAsSpam\s*\(/i,
  /commentThreads\.insert\s*\(/i,
  /videos\.update\s*\(/i,
  /videos\.delete\s*\(/i,
  /videos\.rate\s*\(/i,
  /googleapis\.com\/chat/i,
  /supabase/i,
];

describe("ch19 ships no write surface", () => {
  it("has no API route directory named for sending, replying, chat, queue, or a worker", () => {
    const apiDir = join(SRC_DIR, "app", "api");
    const apiFiles = listFilesRecursively(apiDir);
    for (const path of apiFiles) {
      const lower = path.toLowerCase();
      expect(lower).not.toMatch(/\/(send|reply|comment-write|publish)\//);
      for (const hint of FORBIDDEN_PATH_HINTS) {
        expect(lower).not.toContain(hint);
      }
    }
  });

  it("has no source file that calls a YouTube write method or references Chat/Queue/Supabase", () => {
    for (const path of ALL_SOURCE_FILES) {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      const content = readFileSync(path, "utf8");
      for (const pattern of FORBIDDEN_CONTENT_PATTERNS) {
        expect(content, `${path} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("has no source file that makes a direct POST fetch to the YouTube API (app-internal /api/ routes and oauth2.googleapis.com/token are allowed)", () => {
    for (const path of ALL_SOURCE_FILES) {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) continue;
      const content = readFileSync(path, "utf8");

      // Static check: YOUTUBE_API_BASE must never appear in a context that
      // constructs a POST request — if it does, the file is trying to write
      // to the YouTube API, which this chapter must not ship.
      const hasYoutubeApiBase = content.includes("YOUTUBE_API_BASE");
      if (hasYoutubeApiBase) {
        // If YOUTUBE_API_BASE is present, confirm it's never used with POST.
        // Look for patterns like: fetch(..., { method: "POST" }) where the
        // URL construction references YOUTUBE_API_BASE.
        const fetchPostPattern = /fetch\s*\([^)]*method\s*:\s*["']POST["']/gi;
        const matches = content.match(fetchPostPattern);
        if (matches) {
          for (const match of matches) {
            const matchIndex = content.indexOf(match);
            const contextBefore = content.slice(Math.max(0, matchIndex - 300), matchIndex);
            const contextAfter = content.slice(matchIndex, Math.min(content.length, matchIndex + 300));
            const context = contextBefore + match + contextAfter;

            // If YOUTUBE_API_BASE appears near a POST fetch, it's a YouTube write.
            expect(
              context.includes("YOUTUBE_API_BASE"),
              `${path} contains POST fetch with YOUTUBE_API_BASE: ${match}`,
            ).toBe(false);
          }
        }
      }

      // Runtime check: no POST to googleapis.com/youtube/v3 (the literal URL
      // that YOUTUBE_API_BASE holds), but allow /api/ (app-internal routes)
      // and oauth2.googleapis.com/token (OAuth token refresh).
      const fetchPostPattern = /fetch\s*\([^)]*method\s*:\s*["']POST["']/gi;
      const matches = content.match(fetchPostPattern);
      if (matches) {
        for (const match of matches) {
          const matchIndex = content.indexOf(match);
          const contextBefore = content.slice(Math.max(0, matchIndex - 300), matchIndex);
          const contextAfter = content.slice(matchIndex, Math.min(content.length, matchIndex + 300));
          const context = contextBefore + match + contextAfter;

          // Forbid: direct POST to YouTube Data API v3.
          const isYoutubeApiWrite =
            context.includes("googleapis.com/youtube/v3") || context.includes("www.googleapis.com/youtube");
          expect(
            isYoutubeApiWrite,
            `${path} contains forbidden POST fetch to YouTube API: ${match.slice(0, 80)}`,
          ).toBe(false);

          // Require: must be either app-internal API or OAuth token endpoint.
          const isAppInternalApi = /["'`]\/api\/[^"'`]*["'`]/.test(context);
          const isOAuthTokenEndpoint =
            context.includes("oauth2.googleapis.com/token") || context.includes("TOKEN_ENDPOINT");
          const isAllowed = isAppInternalApi || isOAuthTokenEndpoint;
          expect(
            isAllowed,
            `${path} contains POST fetch that is neither /api/ (app-internal) nor oauth2.googleapis.com/token (OAuth): ${match.slice(0, 80)}`,
          ).toBe(true);
        }
      }
    }
  });

  it("has exactly the three read/generate API routes this chapter needs", () => {
    const apiDir = join(SRC_DIR, "app", "api");
    const routeDirs = readdirSync(apiDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(routeDirs).toEqual(["comments", "review", "video"]);
  });
});
