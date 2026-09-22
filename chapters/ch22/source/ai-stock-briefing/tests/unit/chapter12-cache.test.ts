import assert from "node:assert/strict";
import test from "node:test";

import {
  briefingCacheKey,
  BRIEFING_CACHE_TTL_SECONDS,
  BRIEFING_PROMPT_VERSION,
} from "../../src/lib/briefing-cache-key";
import { fscRequestKey } from "../../src/lib/fsc-request-key";
import {
  FSC_DAILY_SNAPSHOT_TTL_SECONDS,
  FSC_LATEST_DISCOVERY_TTL_SECONDS,
} from "../../src/lib/fsc-cache-policy";
import type { BriefingEvidencePacket } from "../../src/lib/types";

function packet(generatedAt: string, close = 100): BriefingEvidencePacket {
  return {
    schemaVersion: "2.0",
    generatedAt,
    market: { priceBaseDate: "20260818", indexBaseDate: "20260818", indices: [], gainers: [], losers: [] },
    stock: {
      code: "900000", name: "테스트 종목", market: "KOSPI", quoteBaseDate: "20260818",
      close, basePrice: 98, diff: close - 98, changeRate: 2, open: 98, high: 103, low: 97,
      volume: 1_000, tradeValue: 100_000,
    },
    priceHistory: {
      from: "20260817", to: "20260818", tradingDays: 2, startClose: 98, endClose: close,
      highestHigh: 103, lowestLow: 95, closeChange: close - 98, closeChangeRate: 2,
      rangePositionRate: 62.5, isShortHistory: true,
    },
    marketComparison: null,
    filings: {
      state: "none", corpName: null, from: "20260817", to: "20260820",
      totalCount: 0, typeCounts: [], representative: [],
    },
    observations: [], references: [], limits: [],
  };
}

test("생성 시각만 달라진 동일 Evidence는 같은 Gemini Cache key를 쓴다", () => {
  const first = packet("2026-08-20T00:00:00Z");
  const second = packet("2026-08-20T01:00:00Z");
  assert.equal(briefingCacheKey(first, "gemini-3.5-flash-lite", "test"), briefingCacheKey(second, "gemini-3.5-flash-lite", "test"));
});

test("Evidence나 모델이 바뀌면 기존 Gemini Cache key를 쓰지 않는다", () => {
  const first = packet("2026-08-20T00:00:00Z");
  const changed = packet("2026-08-20T00:00:00Z", 101);
  assert.notEqual(briefingCacheKey(first, "gemini-3.5-flash-lite", "test"), briefingCacheKey(changed, "gemini-3.5-flash-lite", "test"));
  assert.notEqual(briefingCacheKey(first, "gemini-3.5-flash-lite", "test"), briefingCacheKey(first, "gemini-2.5-pro", "test"));
});

test("새 prompt version과 1시간 TTL로 기존 저품질 Cache를 재사용하지 않는다", () => {
  assert.equal(BRIEFING_PROMPT_VERSION, "chapter11-grounded-v5-reader-first");
  assert.equal(BRIEFING_CACHE_TTL_SECONDS, 60 * 60);
});

test("Supabase request key는 파라미터 순서와 무관하고 조건 변경에는 달라진다", () => {
  const endpoint = "https://example.test/stock";
  assert.equal(
    fscRequestKey(endpoint, { basDt: "20260818", pageNo: 1 }),
    fscRequestKey(endpoint, { pageNo: 1, basDt: "20260818" })
  );
  assert.notEqual(
    fscRequestKey(endpoint, { basDt: "20260818", pageNo: 1 }),
    fscRequestKey(endpoint, { basDt: "20260819", pageNo: 1 })
  );
});

test("최신 기준일은 한 시간마다 확인하고 기준일이 고정된 일봉은 하루 재사용한다", () => {
  assert.equal(FSC_LATEST_DISCOVERY_TTL_SECONDS, 60 * 60);
  assert.equal(FSC_DAILY_SNAPSHOT_TTL_SECONDS, 24 * 60 * 60);
});
