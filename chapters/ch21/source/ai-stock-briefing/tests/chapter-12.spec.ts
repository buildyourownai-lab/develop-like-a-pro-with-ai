import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

function hasChapter12Secrets() {
  try {
    const source = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    return [
      "DATA_GO_KR_SERVICE_KEY",
      "OPEN_DART_API_KEY",
      "GEMINI_API_KEY",
      "SUPABASE_DATABASE_URL",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
    ].every((name) => new RegExp(`^${name}=\\s*\\S+`, "m").test(source));
  } catch {
    return false;
  }
}

async function measure(request: import("@playwright/test").APIRequestContext, options: {
  code?: string;
  namespace: string;
  redisTtlSeconds?: number;
  databaseTtlSeconds?: number;
  cacheProbeOnly?: boolean;
}) {
  const response = await request.post(`/api/chapter12/measure/${options.code ?? "000660"}`, {
    headers: { "x-chapter12-measurement-token": "chapter12-e2e" },
    data: { profile: "after", ...options },
    timeout: 180_000,
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as {
    metrics: {
      networkCalls: { fsc: number; dart: number; gemini: number };
      geminiTokens: { input: number; output: number; total: number };
      supabase: { hits: number; misses: number; writes: number };
      redis: { hits: number; misses: number; writes: number };
    };
  };
}

test("12장 Golden Path: Supabase 재사용과 Redis Miss/Hit·만료·Evidence 변경을 검증한다", async ({ request }) => {
  test.skip(!hasChapter12Secrets(), "12장 실제 서비스 Secret이 필요하다.");
  test.setTimeout(480_000);
  const namespace = `e2e-${Date.now()}`;

  const cold = await measure(request, { namespace, redisTtlSeconds: 2, databaseTtlSeconds: 2 });
  expect(cold.metrics.supabase.misses).toBeGreaterThan(0);
  expect(cold.metrics.supabase.writes).toBeGreaterThan(0);
  expect(cold.metrics.redis.misses).toBe(1);
  expect(cold.metrics.redis.writes).toBe(1);
  expect(cold.metrics.networkCalls.fsc).toBeGreaterThan(0);
  expect(cold.metrics.networkCalls.gemini).toBe(1);
  expect(cold.metrics.geminiTokens.total).toBeGreaterThan(0);

  const warm = await measure(request, { namespace, redisTtlSeconds: 2, databaseTtlSeconds: 2 });
  expect(warm.metrics.supabase.hits).toBeGreaterThan(0);
  expect(warm.metrics.networkCalls.fsc).toBe(0);
  expect(warm.metrics.redis.hits).toBe(1);
  expect(warm.metrics.networkCalls.gemini).toBe(0);
  expect(warm.metrics.geminiTokens.total).toBe(0);

  await new Promise((resolve) => setTimeout(resolve, 2_500));
  const expired = await measure(request, {
    namespace,
    redisTtlSeconds: 2,
    databaseTtlSeconds: 2,
    cacheProbeOnly: true,
  });
  expect(expired.metrics.networkCalls.fsc).toBeGreaterThan(0);
  expect(expired.metrics.redis.misses).toBe(1);
  expect(expired.metrics.networkCalls.gemini).toBe(0);

  const changedEvidence = await measure(request, { code: "005930", namespace, cacheProbeOnly: true });
  expect(changedEvidence.metrics.redis.misses).toBe(1);
  expect(changedEvidence.metrics.networkCalls.gemini).toBe(0);
});
