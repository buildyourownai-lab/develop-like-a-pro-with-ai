import { describe, it, expect, vi } from "vitest";
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

  it("상장 이력이 짧은 응답은 없는 거래일을 채워 넣지 않는다 (고정 응답)", async () => {
    // 실제 종목은 시간이 흐르면 50거래일을 넘는다. 짧은 이력 처리 자체는
    // 날짜와 제공자 응답을 고정해 검사하고, 위의 시세·연간 검사는 실제 API로 유지한다.
    // Fixture tests provider parsing without calling the real external cache.
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "offline-fsc-key");
    vi.stubEnv("SUPABASE_DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-27T12:00:00+09:00"));
    const dates = ["20260825", "20260826", "20260827"];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({
      response: { header: { resultCode: "00" }, body: { totalCount: 3, items: { item:
        dates.map(basDt => ({ basDt, srtnCd: "0220W0", mkp: "10000", hipr: "11000", lopr: "9000", clpr: "10500", trqu: "100", trPrc: "1050000" }))
      } } },
    })));
    try {
      const yearly = await getYearlyDailyPrices("0220W0");
      expect(yearly.requestedBeginBasDt).toBe("20250827");
      expect(yearly.bars.map(bar => bar.basDt)).toEqual(dates);
      expect(yearly.bars.every(bar => bar.close === 10500)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
