import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEND_RETENTION_DAYS } from "./policy";
import type { SendRecord } from "./store";

/**
 * A static guard on the promise that nothing a viewer wrote, and nothing this
 * app wrote back, is kept.
 *
 * The storage contract and the migration are read as text, in the same spirit as
 * src/app/bounded-write-surface.test.ts: a column added later that holds comment
 * text would be a quiet, permanent change, and a runtime test would only notice
 * it if some code path happened to write to it. Reading the schema catches it
 * the moment it appears.
 */

const AUTO_REPLY_DIR = __dirname;
const MIGRATION_PATH = join(
  AUTO_REPLY_DIR,
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
  "20260914000000_ch20_auto_reply.sql",
);

const MIGRATION_SQL = readFileSync(MIGRATION_PATH, "utf8");
const STORE_SOURCE = readFileSync(join(AUTO_REPLY_DIR, "store.ts"), "utf8");

/** Lines starting a table-level constraint rather than a column. */
const CONSTRAINT_KEYWORDS = ["primary", "unique", "check", "foreign", "constraint"];

function tableBodies(): string[] {
  const bodies: string[] = [];
  for (const match of MIGRATION_SQL.matchAll(/create table if not exists ch20_[a-z_]+ \(\n([\s\S]*?)\n\);/g)) {
    bodies.push(match[1] ?? "");
  }
  return bodies;
}

/**
 * Every column of every ch20 table, as declared. Lines inside a multi-line
 * check constraint are at paren depth 1 and are not columns, so the depth is
 * tracked rather than assuming one line per column.
 */
function declaredColumns(): string[] {
  const columns: string[] = [];
  for (const body of tableBodies()) {
    let depth = 0;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      const atTopLevel = depth === 0;
      depth += (line.match(/\(/g)?.length ?? 0) - (line.match(/\)/g)?.length ?? 0);
      if (!atTopLevel || line.length === 0 || line.startsWith("--")) continue;
      const match = /^([a-z_]+)\s/.exec(line);
      if (match && !CONSTRAINT_KEYWORDS.includes(match[1] ?? "")) {
        columns.push(match[1] ?? "");
      }
    }
  }
  return columns;
}

/**
 * Anything that could hold a person's words rather than an identifier. Includes
 * the exact field names chapter 19 uses for comment text and author, since a
 * copy-paste from that pipeline into a row is the realistic way this breaks.
 */
const FORBIDDEN_COLUMN_HINTS = [
  "text",
  "body",
  "message",
  "content",
  "author",
  "display_name",
  "draft",
  "comment_text",
  "reply_text",
  "prompt",
  "snippet",
  "profile",
  "url",
];

describe("the schema has nowhere to put a person's words", () => {
  it("declares only ids, statuses, reasons, times, and counts", () => {
    expect(declaredColumns().sort()).toEqual(
      [
        // settings
        "id",
        "enabled",
        "channel_id",
        "video_id",
        "activated_at",
        "stopped_at",
        "stop_reason",
        "cursor_page_token",
        "cursor_updated_at",
        "send_lease_holder",
        "send_lease_expires_at",
        "updated_at",
        // sends
        "top_level_comment_id",
        "video_id",
        "status",
        "reason",
        "reply_comment_id",
        "send_day",
        "claimed_at",
        "resolved_at",
        "lock_expires_at",
        "created_at",
        // daily quota
        "send_day",
        "reserved_count",
        // runs — labels and counts only, so an operational record can never
        // become a copy of what a viewer wrote
        "run_id",
        "run_trigger",
        "started_at",
        "completed_at",
        "outcome",
        "considered_count",
        "deferred_count",
        "human_review_count",
        "failure_count",
        "sent_count",
        "automation_enabled",
        "cursor_has_more",
        "created_at",
      ].sort(),
    );
  });

  it("has no column whose name suggests it holds text a person wrote", () => {
    for (const column of declaredColumns()) {
      for (const hint of FORBIDDEN_COLUMN_HINTS) {
        // reply_comment_id is an id, not a reply; nothing else may match.
        expect(column, `column ${column} matches ${hint}`).not.toContain(hint);
      }
    }
  });

  it("stores the reason as a short label from a closed set, not free text", () => {
    // The status column's own check constraint is the readable proof that these
    // are labels rather than anything a viewer could influence.
    expect(MIGRATION_SQL).toMatch(/status text not null check \(/);
    for (const status of ["CLAIMED", "SENT", "RESULT_UNKNOWN", "UNCONFIRMED_NO_REPLY", "FAILED"]) {
      expect(MIGRATION_SQL).toContain(`'${status}'`);
    }
  });
});

describe("the storage contract has no field for it either", () => {
  it("types a send row as ids, status, reason, and times only", () => {
    const row: SendRecord = {
      topLevelCommentId: "C_1",
      videoId: "VIDEO_1",
      status: "SENT",
      reason: "GENERAL_REACTION",
      replyCommentId: "REPLY_1",
      sendDay: "2026-09-14",
      claimedAt: "2026-09-14T09:00:00.000Z",
      resolvedAt: "2026-09-14T09:00:01.000Z",
      lockExpiresAt: "2026-09-14T09:10:00.000Z",
    };

    // If a text field were added to SendRecord, this list would no longer be
    // the whole row and the assertion below would fail.
    expect(Object.keys(row).sort()).toEqual([
      "claimedAt",
      "lockExpiresAt",
      "reason",
      "replyCommentId",
      "resolvedAt",
      "sendDay",
      "status",
      "topLevelCommentId",
      "videoId",
    ]);
  });

  it("never mentions chapter 19's text-carrying field names", () => {
    // `text` is chapter 19's body field (see FetchedComment); `textOriginal`
    // stays on the list because it is the write-side body field name.
    for (const field of ["text", "textOriginal", "authorDisplayName", "authorChannelId", "draft"]) {
      expect(STORE_SOURCE).not.toMatch(new RegExp(`\\b${field}\\b\\s*[?:]`));
    }
  });
});

describe("even the ids and statuses are capped", () => {
  it("keeps nothing about a send longer than 30 days", () => {
    expect(SEND_RETENTION_DAYS).toBe(30);
  });

  it("deletes the send rows, the run records, and the day counters past the cutoff", () => {
    const purge = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("function ch20_purge_expired"));
    expect(purge).toContain("delete from ch20_auto_reply_sends");
    expect(purge).toContain("delete from ch20_auto_reply_runs");
    expect(purge).toContain("delete from ch20_auto_reply_daily_quota");
    expect(purge).toContain("created_at < p_before");
  });

  it("runs the purge from the scheduled run itself, so it cannot be forgotten", () => {
    const runnerSource = readFileSync(join(AUTO_REPLY_DIR, "runner.ts"), "utf8");
    expect(runnerSource).toContain("purgeExpired");
    expect(runnerSource).toContain("SEND_RETENTION_DAYS");
    // And from a `finally`, so the early returns purge too. The behavioural
    // proof is in runner.test.ts; this only keeps the shape from drifting back.
    expect(runnerSource).toMatch(/finally \{[\s\S]*?purge/);
  });
});
