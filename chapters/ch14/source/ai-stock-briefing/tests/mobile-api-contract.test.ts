import { describe, expect, it, vi } from "vitest";

const marketOverview = vi.hoisted(() => vi.fn());
vi.mock("@/lib/market", () => ({ getMarketOverview: marketOverview }));
vi.mock("@/lib/krx-listed-info-api", () => ({ searchListedStocksWithBaseDate: vi.fn() }));
vi.mock("@/lib/stock-price-api", () => ({
  getLatestStockPriceByCode: vi.fn(),
  getLatestStockPrices: vi.fn(),
  getYearlyDailyPrices: vi.fn(),
}));
vi.mock("@/lib/dart-disclosure-api", () => ({
  getDisclosurePageByStockCode: vi.fn(),
  getRecentDisclosuresByStockCode: vi.fn(),
}));
vi.mock("@/lib/trading-date", () => ({
  formatYyyyMmDd: vi.fn(() => "20260906"),
  subtractDaysYyyyMmDd: vi.fn(() => "20250906"),
}));

import {
  MobileRequestError,
  mobileErrorResponse,
  mobileMarketResponse,
  normalizeMobileStockCode,
  toMobileFiling,
} from "@/lib/mobile-api";

describe("모바일 응답 변환 계약", () => {
  it("영숫자 신형 종목코드를 허용하고 잘못된 코드는 400 오류로 구분한다", () => {
    expect(normalizeMobileStockCode("12345a")).toBe("12345A");
    expect(() => normalizeMobileStockCode("123")).toThrow(MobileRequestError);
    try {
      normalizeMobileStockCode("123");
    } catch (caught) {
      expect((caught as MobileRequestError).status).toBe(400);
      expect((caught as MobileRequestError).code).toBe("INVALID_STOCK_CODE");
    }
  });

  it("OpenDART 비고 코드를 풀어 쓰고 공시 문자열의 바깥 공백을 없앤다", () => {
    expect(toMobileFiling({
      receiptNo: "1",
      receiptDate: "20260906",
      reportName: " 보고서 ",
      submitter: " 제출인 ",
      remarks: "유정",
      dartUrl: "https://dart.fss.or.kr/x",
    })).toEqual({
      receiptNo: "1",
      receiptDate: "20260906",
      reportName: "보고서",
      filerName: "제출인",
      noteLabels: ["유가증권시장", "정정 보고"],
      documentUrl: "https://dart.fss.or.kr/x",
    });
  });

  it("두 지수 기준일이 다르면 공통 기준일을 만들지 않고 거래대금을 보존한다", async () => {
    marketOverview.mockResolvedValue({
      stockBaseDate: "20260906",
      indices: [
        { name: "코스피", baseDate: "20260906", value: 1, change: 2, changeRate: 3, open: 4, high: 5, low: 6, tradingValue: 7 },
        { name: "코스닥", baseDate: "20260905", value: 8, change: 9, changeRate: 10, open: 11, high: 12, low: 13, tradingValue: 14 },
      ],
      topGainers: [],
      topLosers: [],
      totalStockCount: 2,
      eligibleStockCount: 1,
    });
    const response = await mobileMarketResponse();
    expect(response.market.indexBaseDate).toBeNull();
    expect(response.market.indices.map((item) => item.tradeValue)).toEqual([7, 14]);
  });

  it("예상하지 못한 상류 오류의 원문을 노출하지 않는다", async () => {
    const response = mobileErrorResponse(new Error("secret upstream detail"));
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "서버가 공식 자료를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.",
      code: "UPSTREAM_FAILURE",
    });
  });
});
