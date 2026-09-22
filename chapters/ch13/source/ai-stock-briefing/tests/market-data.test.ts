import { describe, it, expect } from "vitest";
import { getMarketOverview } from "@/lib/market";

function isValidBasDt(basDt: string): boolean {
  return /^\d{8}$/.test(basDt);
}

describe("실제 금융위원회 API로 시장 현황을 가져온다", () => {
  it("지수(코스피·코스닥)와 종목 시세의 기준일이 실제로 온다", async () => {
    const overview = await getMarketOverview();

    expect(overview.indices).toHaveLength(2);
    for (const idx of overview.indices) {
      expect(isValidBasDt(idx.baseDate)).toBe(true);
      expect(Number.isFinite(idx.value)).toBe(true);
    }
    expect(isValidBasDt(overview.stockBaseDate)).toBe(true);
  });

  it("등락률 순위 조건과 대상 종목 수를 실제로 계산한다", async () => {
    const overview = await getMarketOverview();

    expect(overview.rankingCondition.length).toBeGreaterThan(0);
    expect(overview.totalStockCount).toBeGreaterThan(0);
    expect(overview.eligibleStockCount).toBeGreaterThan(0);
    expect(overview.eligibleStockCount).toBeLessThanOrEqual(
      overview.totalStockCount
    );
  });

  it("상승률 상위·하락률 상위 5종목이 실제로 채워진다", async () => {
    const overview = await getMarketOverview();

    expect(overview.topGainers.length).toBeGreaterThan(0);
    expect(overview.topGainers.length).toBeLessThanOrEqual(5);
    expect(overview.topLosers.length).toBeGreaterThan(0);
    expect(overview.topLosers.length).toBeLessThanOrEqual(5);

    // 상위 5개는 등락률 내림차순, 하위 5개는 오름차순이어야 한다.
    const gainRates = overview.topGainers.map((s) => s.changeRate);
    const lossRates = overview.topLosers.map((s) => s.changeRate);
    expect(gainRates).toEqual([...gainRates].sort((a, b) => b - a));
    expect(lossRates).toEqual([...lossRates].sort((a, b) => a - b));
  });

  it("등락률 순위에 오른 종목은 모두 보통주이고 거래대금 10억원 이상이다", async () => {
    const overview = await getMarketOverview();
    const ranked = [...overview.topGainers, ...overview.topLosers];

    expect(ranked.length).toBeGreaterThan(0);
    for (const stock of ranked) {
      // 우선주·스팩은 종목코드 끝자리가 "0"이 아니거나 이름에 "스팩"이
      // 들어가므로, 순위에 남은 종목은 코드가 "0"으로 끝나야 한다.
      expect(stock.code.endsWith("0")).toBe(true);
      expect(stock.name.includes("스팩")).toBe(false);
      expect(stock.tradingValue).toBeGreaterThanOrEqual(1_000_000_000);
    }
  });
});
