import "server-only";

import {
  briefingCacheKey as buildBriefingCacheKey,
  BRIEFING_CACHE_TTL_SECONDS,
} from "./briefing-cache-key";
import { chapter12Options, recordChapter12Metric } from "./chapter12-metrics";
import type { BriefingEvidencePacket, GroundedBriefing } from "./types";

export type CachedBriefing = {
  briefing: GroundedBriefing;
  model: string;
  generatedAt: string;
};

function redisConfig() {
  const url = (process.env.UPSTASH_REDIS_REST_URL)?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN)?.trim();
  if (!url || !token) throw new Error("Upstash Redis REST 설정이 준비되지 않았습니다.");
  if (!/^https:\/\//i.test(url)) throw new Error("Upstash Redis REST URL 형식이 올바르지 않습니다.");
  return { url: url.replace(/\/$/, ""), token };
}

async function command<T>(operation: string, args: (string | number)[]): Promise<T> {
  const { url, token } = redisConfig();
  const started = performance.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Redis 요청이 실패했습니다. (HTTP ${response.status})`);
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error(`Redis가 오류를 반환했습니다. (${payload.error})`);
  recordChapter12Metric({ service: "redis", operation, durationMs: performance.now() - started });
  return payload.result as T;
}

export function briefingCacheKey(packet: BriefingEvidencePacket, model: string, namespace = chapter12Options().namespace) {
  return buildBriefingCacheKey(packet, model, namespace);
}

export async function readCachedBriefing(
  packet: BriefingEvidencePacket,
  model: string
): Promise<CachedBriefing | null> {
  if (!chapter12Options().redisEnabled) return null;
  const result = await command<string | null>("get-briefing", ["GET", briefingCacheKey(packet, model)]);
  if (result === null) {
    recordChapter12Metric({ service: "redis", operation: "briefing-cache", durationMs: 0, outcome: "miss" });
    return null;
  }
  try {
    const cached = JSON.parse(result) as CachedBriefing;
    recordChapter12Metric({ service: "redis", operation: "briefing-cache", durationMs: 0, outcome: "hit" });
    return cached;
  } catch {
    await command<number>("delete-invalid-briefing", ["DEL", briefingCacheKey(packet, model)]);
    recordChapter12Metric({ service: "redis", operation: "briefing-cache", durationMs: 0, outcome: "miss" });
    return null;
  }
}

export async function writeCachedBriefing(
  packet: BriefingEvidencePacket,
  value: CachedBriefing,
  model: string
): Promise<void> {
  if (!chapter12Options().redisEnabled) return;
  const ttl = chapter12Options().redisTtlSeconds ?? BRIEFING_CACHE_TTL_SECONDS;
  await command<string>("set-briefing", [
    "SET",
    briefingCacheKey(packet, model),
    JSON.stringify(value),
    "EX",
    ttl,
  ]);
  recordChapter12Metric({ service: "redis", operation: "briefing-cache", durationMs: 0, outcome: "write" });
}
