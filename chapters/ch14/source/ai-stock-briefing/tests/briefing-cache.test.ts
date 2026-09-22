import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EvidencePacket, StructuredBriefing } from "@/lib/gemini-briefing-api";

const store = new Map<string, unknown>();
const redis = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  set: vi.fn(async (key: string, value: unknown) => { store.set(key, value); return "OK"; }),
};
vi.mock("@/lib/redis", () => ({
  isUpstashConfigured: () => true,
  getRedis: () => redis,
  toSafeRedisError: (error: unknown) => error instanceof Error ? error : new Error(String(error)),
}));

const { getCachedBriefing, setCachedBriefing } = await import("@/lib/briefing-cache");
const packet = (generatedAt: string): EvidencePacket => ({
  generatedAt,
  observations: [{ id: "STOCK_QUOTE", text: "종가는 1000원이다.", sourceIds: ["FSC_STOCK"] }],
  references: [{ id: "FSC_STOCK", label: "금융위원회", url: "https://example.com" }],
  limits: ["미래 가격은 알 수 없다."],
});
const briefing: StructuredBriefing = {
  headline: "확인된 사실 요약",
  highlights: [{ text: "확인된 자료만 요약했다.", evidenceIds: ["LIMITS"] }, { text: "미래 가격은 알 수 없다.", evidenceIds: ["LIMITS"] }],
  marketContext: [{ text: "시장 설명", evidenceIds: ["LIMITS"] }],
  priceContext: [{ text: "가격 설명", evidenceIds: ["STOCK_QUOTE"] }],
  filingContext: [{ text: "공시 설명", evidenceIds: ["LIMITS"] }],
  unknowns: [{ text: "미래 가격은 알 수 없다.", evidenceIds: ["LIMITS"] }],
};

beforeEach(() => { store.clear(); redis.get.mockClear(); redis.set.mockClear(); });

describe("구조화 브리핑 Redis 캐시", () => {
  it("검증된 구조화 결과를 저장하고 생성 시각만 달라도 재사용한다", async () => {
    await setCachedBriefing("000660", packet("2026-09-05T01:00:00Z"), briefing);
    await expect(getCachedBriefing("000660", packet("2026-09-05T01:01:00Z"))).resolves.toEqual(briefing);
  });

  it("근거가 달라지면 이전 결과를 재사용하지 않는다", async () => {
    await setCachedBriefing("000660", packet("2026-09-05T01:00:00Z"), briefing);
    const changed = packet("2026-09-05T01:01:00Z");
    changed.observations[0].text = "종가는 2000원이다.";
    await expect(getCachedBriefing("000660", changed)).resolves.toBeUndefined();
  });
});
