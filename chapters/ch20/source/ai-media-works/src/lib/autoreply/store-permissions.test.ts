import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A static guard on who can reach the auto-reply state store.
 *
 * The migration's functions are security definer, which means they run with the
 * table owner's rights and ignore the row level security switched on beside
 * them. That is deliberate — the server needs them — but it also means the
 * EXECUTE grant is the only thing standing between a browser-side key and
 * ch20_enable_schedule or ch20_claim_send. PostgreSQL grants EXECUTE to PUBLIC when a
 * function is created, so "server only" is true only while every function is
 * explicitly revoked and re-granted to service_role.
 *
 * This is read as text rather than executed because the assertion is about a
 * file a person will paste into Supabase once, and this repository never
 * connects to a database in a test.
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
const ADAPTER_SOURCE = readFileSync(join(AUTO_REPLY_DIR, "supabase-store.ts"), "utf8");

const TABLES = [
  "ch20_auto_reply_settings",
  "ch20_auto_reply_sends",
  "ch20_auto_reply_daily_quota",
  "ch20_auto_reply_runs",
];

/**
 * Every function the migration declares, with the argument-type signature
 * PostgreSQL needs to identify it. Building the signature from the declaration
 * (rather than trusting the revoke lines to name it correctly) is what makes a
 * typo in a revoke line a failing test instead of a function left open.
 */
function declaredFunctions(): string[] {
  const signatures: string[] = [];
  for (const match of MIGRATION_SQL.matchAll(
    /create or replace function (ch20_[a-z_0-9]+)\(([\s\S]*?)\)\s*\nreturns/g,
  )) {
    const name = match[1] ?? "";
    const params = (match[2] ?? "").trim();
    const types =
      params.length === 0
        ? []
        : params
            .split(",")
            .map((param) => param.trim().split(/\s+/).slice(1).join(" "))
            .filter((type) => type.length > 0);
    signatures.push(`${name}(${types.join(", ")})`);
  }
  return signatures;
}

describe("only the server's role may call the state store", () => {
  it("declares the twenty-two functions the adapter uses", () => {
    expect(declaredFunctions()).toHaveLength(22);
  });

  it("revokes execute from public, anon, and authenticated on every one of them", () => {
    for (const signature of declaredFunctions()) {
      expect(MIGRATION_SQL).toContain(
        `revoke execute on function ${signature} from public, anon, authenticated;`,
      );
    }
  });

  it("grants execute back to service_role only", () => {
    for (const signature of declaredFunctions()) {
      expect(MIGRATION_SQL).toContain(`grant execute on function ${signature} to service_role;`);
    }
    const grants = MIGRATION_SQL.split("\n").filter((line) => line.trim().startsWith("grant "));
    expect(grants).toHaveLength(declaredFunctions().length);
    for (const line of grants) {
      // A grant to anon or authenticated would undo the revoke above.
      expect(line.trim()).toMatch(/ to service_role;$/);
    }
  });

  it("leaves row level security on with no policy, so a leaked key reads nothing", () => {
    for (const table of TABLES) {
      expect(MIGRATION_SQL).toContain(`alter table ${table} enable row level security;`);
      expect(MIGRATION_SQL).toContain(`revoke all on ${table} from anon, authenticated;`);
    }
    expect(MIGRATION_SQL).not.toMatch(/create policy/i);
  });

  it("holds no secret value, only names", () => {
    expect(MIGRATION_SQL).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY\s*=/);
    expect(MIGRATION_SQL).not.toMatch(/apikey/i);
    expect(MIGRATION_SQL).not.toMatch(/Bearer /);
  });
});

describe("the adapter and the migration agree", () => {
  it("calls only functions this migration declares", () => {
    const declared = new Set(
      declaredFunctions().map((signature) => signature.slice(0, signature.indexOf("("))),
    );
    const called = new Set(
      [...ADAPTER_SOURCE.matchAll(/"(ch20_[a-z_0-9]+)"/g)].map((match) => match[1] ?? ""),
    );
    expect([...called].sort().filter((name) => !declared.has(name))).toEqual([]);
    // And every declared function is actually reachable — a function nobody
    // calls is a permission surface with no purpose.
    expect([...declared].sort().filter((name) => !called.has(name))).toEqual([]);
  });
});
