import { expect, it, vi } from "vitest";
const db = vi.hoisted(() => vi.fn());
vi.mock("../../src/lib/db", () => ({ getDb: db, toSafeDbError: () => new Error("cache unavailable") }));
import { withCache, CACHE_TTL_SECONDS } from "../../src/lib/api-cache";
it("REST cache hit bypasses Node DDL and compute; unavailable REST falls back", async () => {
  vi.stubEnv("FSC_SNAPSHOT_TRANSPORT", "rest"); vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture");
  const compute = vi.fn().mockResolvedValue("fresh");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ payload: false }])));
  expect(await withCache("key", 3600, compute)).toBe(false); expect(compute).not.toHaveBeenCalled();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await withCache("key", 3600, compute)).toBe("fresh"); expect(db).not.toHaveBeenCalled(); warning.mockRestore();
});

it("keeps default Node DDL/read/write and the 1h/24h TTL contract", async () => {
  db.mockClear(); vi.stubEnv("FSC_SNAPSHOT_TRANSPORT", ""); vi.stubEnv("SUPABASE_DATABASE_URL", "postgresql://fixture.invalid/db");
  const sql = Object.assign(vi.fn().mockResolvedValue([]), { json: (value: unknown) => value }); db.mockReturnValue(sql);
  const random = vi.spyOn(Math, "random").mockReturnValue(1);
  expect(CACHE_TTL_SECONDS).toEqual({ latestTradingDate: 3600, confirmedMarketData: 86400 });
  expect(await withCache("node-key", 86400, async () => "fresh")).toBe("fresh");
  const statements = sql.mock.calls.map(call => (call[0] as TemplateStringsArray).join("?"));
  expect(statements.some(text => text.includes("create table if not exists api_cache"))).toBe(true);
  expect(statements.some(text => text.includes("select payload from api_cache"))).toBe(true);
  expect(statements.some(text => text.includes("insert into api_cache"))).toBe(true);
  expect(sql.mock.calls.find(call => (call[0] as TemplateStringsArray).join("").includes("insert into"))?.slice(1)).toContain(86400);
  random.mockRestore();
});
