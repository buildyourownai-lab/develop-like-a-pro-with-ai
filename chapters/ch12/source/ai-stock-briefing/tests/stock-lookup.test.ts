import { describe, it, expect } from "vitest";
import { searchListedStocks } from "@/lib/krx-listed-info-api";
import {
  getLatestStockPriceByCode,
  getYearlyDailyPrices,
} from "@/lib/stock-price-api";

describe("실제 KRX상장종목정보로 종목을 검색한다", () => {
  it("정확한 종목명은 1건으로 좁혀진다", async () => {
    const results = await searchListedStocks("삼성전자");
    expect(results).toHaveLength(1);
    expect(results[0].code).toBe("005930");
    expect(results[0].market).toBe("KOSPI");
  });

  it("부분 이름은 여러 건으로 나온다", async () => {
    const results = await searchListedStocks("삼성");
    expect(results.length).toBeGreaterThan(1);
    expect(results.some((r) => r.code === "005930")).toBe(true);
  });

  it("존재하지 않는 이름은 0건이다", async () => {
    const results = await searchListedStocks("이런종목은없다없다없다");
    expect(results).toHaveLength(0);
  });
});

describe("실제 주식시세정보로 종목 상세를 가져온다", () => {
  it("종목코드로 현재가·시가·고가·저가·거래량을 가져온다", async () => {
    const result = await getLatestStockPriceByCode("005930");
    expect(result).not.toBeNull();
    expect(result?.item.itmsNm).toBe("삼성전자");
    expect(result?.item.mrktCtg).toBe("KOSPI");
    expect(Number(result?.item.clpr)).toBeGreaterThan(0);
    expect(/^\d{8}$/.test(result?.basDt ?? "")).toBe(true);
  });

  it("최근 1년 일별 시세를 날짜 오름차순으로 가져온다", async () => {
    const yearly = await getYearlyDailyPrices("005930");
    expect(yearly.bars.length).toBeGreaterThan(200);
    for (let i = 1; i < yearly.bars.length; i++) {
      expect(yearly.bars[i].basDt > yearly.bars[i - 1].basDt).toBe(true);
    }
  });

  it("이력이 짧은 종목은 1년치를 다 채우지 않는다", async () => {
    // 13번에서 실제로 확인한, 최근 며칠치만 있는 종목.
    const yearly = await getYearlyDailyPrices("0220W0");
    expect(yearly.bars.length).toBeGreaterThan(0);
    expect(yearly.bars.length).toBeLessThan(50);
  });
});
