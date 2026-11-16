import "server-only";
import { getSupabaseRestConfig } from "./server-env";
async function request(method: string, params: Record<string, string>, body?: unknown): Promise<unknown> {
  const { url, key } = getSupabaseRestConfig();
  const endpoint = new URL("/rest/v1/api_cache", url);
  endpoint.search = new URLSearchParams(params).toString();
  try {
    const response = await fetch(endpoint, {
      method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json",
        Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=representation" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error();
    return method === "POST" ? undefined : await response.json();
  } catch { throw new Error("Supabase REST cache request failed"); }
}
export async function readRestCache<T>(key: string): Promise<T | undefined> {
  const rows = await request("GET", { select: "payload", cache_key: `eq.${key}`, expires_at: `gt.${new Date().toISOString()}`, limit: "1" });
  if (!Array.isArray(rows) || rows.length > 1 || rows.some(row => !row || typeof row !== "object" || !("payload" in row))) throw new Error("Invalid Supabase cache response");
  return rows[0]?.payload as T | undefined;
}
export async function writeRestCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error("Invalid cache TTL");
  const now = Date.now();
  await request("POST", { on_conflict: "cache_key" }, { cache_key: key, payload: value, expires_at: new Date(now + ttlSeconds * 1000).toISOString(), created_at: new Date(now).toISOString() });
}
export async function cleanupExpiredRestCache(): Promise<number> {
  const rows = await request("DELETE", { expires_at: `lte.${new Date().toISOString()}`, select: "cache_key" });
  if (!Array.isArray(rows)) throw new Error("Invalid Supabase cache response");
  return rows.length;
}
