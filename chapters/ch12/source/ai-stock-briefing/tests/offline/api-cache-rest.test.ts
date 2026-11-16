import { beforeEach, expect, it, vi } from "vitest";
import { readRestCache, writeRestCache, cleanupExpiredRestCache } from "../../src/lib/api-cache-rest";
import { isSupabaseDatabaseConfigured, getSupabaseRestConfig } from "../../src/lib/server-env";
beforeEach(() => { vi.stubEnv("FSC_SNAPSHOT_TRANSPORT", "rest"); vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co"); vi.stubEnv("SUPABASE_SECRET_KEY", "fixture-secret"); vi.stubEnv("SUPABASE_DATABASE_URL", ""); });
it("activates REST without a direct DB URL and preserves false/null payloads", async () => {
  expect(isSupabaseDatabaseConfigured()).toBe(true);
  for (const payload of [false, null, 0]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ payload }])));
    expect(await readRestCache("fixture")).toBe(payload);
  }
});
it("encodes exact key filters and expired-only cleanup", async () => {
  const mock = vi.fn().mockImplementation(() => Promise.resolve(Response.json([]))); vi.stubGlobal("fetch", mock);
  const key = 'a,b&expires_at=gte.0'; await readRestCache(key);
  const url = mock.mock.calls[0][0] as URL;
  expect(url.pathname).toBe("/rest/v1/api_cache"); expect(url.searchParams.get("cache_key")).toBe(`eq.${key}`);
  expect(url.searchParams.get("expires_at")).toMatch(/^gt\./);
  await cleanupExpiredRestCache();
  expect(mock.mock.calls[1][0].searchParams.get("expires_at")).toMatch(/^lte\./);
  expect(mock.mock.calls[1][1].method).toBe("DELETE");
});
it("upserts existing schema with one-hour expiry and bounded request", async () => {
  const mock = vi.fn().mockResolvedValue(new Response(null, { status: 204 })); vi.stubGlobal("fetch", mock);
  await writeRestCache("key", { value: 1 }, 3600);
  await writeRestCache("daily", { value: 1 }, 86400);
  const daily = JSON.parse(mock.mock.calls[1][1].body);
  expect(Date.parse(daily.expires_at) - Date.parse(daily.created_at)).toBe(86400000);
  const [url, init] = mock.mock.calls[0]; const body = JSON.parse(init.body);
  expect(url.searchParams.get("on_conflict")).toBe("cache_key");
  expect(Object.keys(body).sort()).toEqual(["cache_key", "created_at", "expires_at", "payload"]);
  expect(Date.parse(body.expires_at) - Date.parse(body.created_at)).toBe(3600000);
  expect(init.redirect).toBe("manual"); expect(init.cache).toBe("no-store");
});
it("rejects hostile configuration and sanitizes provider/network errors", async () => {
  for (const value of ["http://fixture.supabase.co", "https://user:pass@fixture.supabase.co", "https://fixture.supabase.co/rest?secret=x"]) {
    vi.stubEnv("SUPABASE_URL", value); expect(() => getSupabaseRestConfig()).toThrow();
  }
  vi.stubEnv("SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fixture-secret")));
  await expect(readRestCache("key")).rejects.toThrow(/^Supabase REST cache request failed$/);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ payload: "invalid" })));
  await expect(readRestCache("key")).rejects.toThrow("Invalid Supabase cache response");
});
