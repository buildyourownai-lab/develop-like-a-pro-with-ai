import { describe, it, expect } from "vitest";
import {
  buildMarketComparison,
  buildPriceFlow,
  buildUnknownCaveats,
  describeMarketComparison,
  type StockQuoteFact,
  type IndexQuoteFact,
  type DisclosureFacts,
} from "@/lib/briefing-facts";
import type { DailyPriceBar } from "@/lib/stock-price-api";

function stock(overrides: Partial<StockQuoteFact> = {}): StockQuoteFact {
  return {
    name: "SK하이닉스",
    code: "000660",
    market: "KOSPI",
    baseDate: "20260827",
    price: 1730000,
    change: 42000,
    changeRate: 2.49,
    ...overrides,
  };
}

function index(overrides: Partial<IndexQuoteFact> = {}): IndexQuoteFact {
  return {
    name: "코스피",
    baseDate: "20260827",
    value: 6912.37,
    change: 104.16,
    changeRate: 1.53,
    ...overrides,
  };
}

function bar(overrides: Partial<DailyPriceBar> = {}): DailyPriceBar {
  return {
    basDt: "20260101",
    open: 100,
    high: 110,
    low: 90,
    close: 100,
    volume: 1000,
    tradingValue: 100000,
    ...overrides,
  };
}

describe("buildMarketComparison — 프로그램이 직접 계산하는 시장 대비 차이", () => {
  it("종목 등락률에서 지수 등락률을 뺀 값(%p)을 그대로 돌려준다", () => {
    const [comparison] = buildMarketComparison(stock({ changeRate: 2.49 }), [
      index({ changeRate: 1.53 }),
    ]);
    expect(comparison.deltaPp).toBeCloseTo(0.96, 5);
  });

  it("부동소수 오차 없이 소수 둘째 자리로 반올림한다", () => {
    const [comparison] = buildMarketComparison(stock({ changeRate: 29.98 }), [
      index({ changeRate: 1.3 }),
    ]);
    // 29.98 - 1.3 = 28.68 그대로, 0.1+0.2 같은 부동소수 오차가 섞이면 안 된다.
    expect(comparison.deltaPp).toBe(28.68);
  });

  it.each([
    [0.5, "비슷한 수준"],
    [0.99, "비슷한 수준"],
    [1, "약간"],
    [4.99, "약간"],
    [5, "큰 폭"],
    [14.99, "큰 폭"],
    [15, "훨씬 큰 폭"],
    [30, "훨씬 큰 폭"],
  ])(
    "차이가 %f%%p면 구간 라벨은 '%s'다 (이 구간은 앱이 정한 임의 기준)",
    (delta, expectedLabel) => {
      const [comparison] = buildMarketComparison(
        stock({ changeRate: delta }),
        [index({ changeRate: 0 })]
      );
      expect(comparison.deltaPp).toBe(delta);
      expect(comparison.magnitude).toBe(expectedLabel);
    }
  );

  it("음수 차이(지수가 더 많이 오른 경우)도 절댓값으로 구간을 매긴다", () => {
    const [comparison] = buildMarketComparison(stock({ changeRate: 0 }), [
      index({ changeRate: 20 }),
    ]);
    expect(comparison.deltaPp).toBe(-20);
    expect(comparison.magnitude).toBe("훨씬 큰 폭");
  });

  it("KOSPI 종목은 코스피 지수만 '이 종목이 속한 시장'으로 표시한다", () => {
    const [kospi, kosdaq] = buildMarketComparison(stock({ market: "KOSPI" }), [
      index({ name: "코스피" }),
      index({ name: "코스닥" }),
    ]);
    expect(kospi.isOwnMarket).toBe(true);
    expect(kosdaq.isOwnMarket).toBe(false);
  });

  it("KOSDAQ 종목은 코스닥 지수만 '이 종목이 속한 시장'으로 표시한다", () => {
    const [kospi, kosdaq] = buildMarketComparison(
      stock({ market: "KOSDAQ" }),
      [index({ name: "코스피" }), index({ name: "코스닥" })]
    );
    expect(kospi.isOwnMarket).toBe(false);
    expect(kosdaq.isOwnMarket).toBe(true);
  });
});

describe("describeMarketComparison — 계산된 숫자를 문장으로만 바꾼다(새로 계산하지 않음)", () => {
  it("비슷한 수준일 때는 '높다/낮다'로 방향을 단정하지 않는다", () => {
    const [comparison] = buildMarketComparison(stock({ changeRate: 1.9 }), [
      index({ changeRate: 1.53 }),
    ]);
    const text = describeMarketComparison(comparison, "SK하이닉스");
    expect(text).toContain("비슷한 수준");
    expect(text).not.toContain("높다");
    expect(text).not.toContain("낮다");
    expect(text).toContain(String(comparison.deltaPp));
  });

  it("차이가 크면 방향(높다/낮다)과 구간 라벨을 함께 담는다", () => {
    const [comparison] = buildMarketComparison(stock({ changeRate: 29.98 }), [
      index({ changeRate: 1.3 }),
    ]);
    const text = describeMarketComparison(comparison, "파루");
    expect(text).toContain("훨씬 큰 폭으로 높다");
    expect(text).toContain("28.68");
  });
});

describe("buildPriceFlow — 최근 1년 가격 흐름을 프로그램이 직접 계산한다", () => {
  it("기간 시작·마지막 종가와 변동률을 계산한다", () => {
    const bars = [
      bar({ basDt: "20250901", close: 1000, high: 1000, low: 1000, volume: 10 }),
      bar({ basDt: "20260827", close: 1500, high: 1500, low: 1500, volume: 10 }),
    ];
    const flow = buildPriceFlow(stock({ price: 1500, changeRate: 3 }), bars);

    expect(flow.periodStartPrice).toBe(1000);
    expect(flow.periodStartDate).toBe("20250901");
    expect(flow.periodEndPrice).toBe(1500);
    expect(flow.periodEndDate).toBe("20260827");
    expect(flow.periodChangeRate).toBe(50);
    expect(flow.noTradeDayCount).toBe(0);
  });

  it("시작 종가가 0이면 변동률은 계산하지 않고 null이다(0으로 나누지 않음)", () => {
    const bars = [
      bar({ basDt: "20250901", close: 0, volume: 10 }),
      bar({ basDt: "20260827", close: 1500, volume: 10 }),
    ];
    const flow = buildPriceFlow(stock(), bars);
    expect(flow.periodChangeRate).toBeNull();
  });

  it("일별 시세가 하나도 없으면 종목의 현재가로만 채우고 나머지는 계산 불가로 둔다", () => {
    const flow = buildPriceFlow(stock({ price: 1730000, baseDate: "20260827" }), []);
    expect(flow.periodStartPrice).toBe(1730000);
    expect(flow.periodEndPrice).toBe(1730000);
    expect(flow.periodChangeRate).toBeNull();
    expect(flow.yearHigh).toBeNull();
    expect(flow.yearLow).toBeNull();
    expect(flow.noTradeDayCount).toBe(0);
  });

  // 파루(043200)를 실제로 확인해 찾은 문제를 회귀 테스트로 남긴다: 거래정지
  // 기간에는 금융위원회 API가 시가·고가·저가·거래량을 0으로, 종가만 정지
  // 직전 값으로 채워 돌려준다(2026-08-04~08-26 실제로 확인함). 이 날들을
  // 최고가·최저가 계산에 그대로 섞으면 없었던 "0원 거래"가 최저가로 잡힌다.
  it("거래정지로 시가·고가·저가·거래량이 0인 날은 최고가·최저가 계산에서 뺀다", () => {
    const bars = [
      bar({ basDt: "20260801", open: 600, high: 620, low: 580, close: 600, volume: 1000 }),
      // 거래정지: 실제 파루 데이터 그대로(거래량 0, OHLC 0, 종가만 이전값 유지)
      bar({ basDt: "20260804", open: 0, high: 0, low: 0, close: 600, volume: 0 }),
      bar({ basDt: "20260805", open: 0, high: 0, low: 0, close: 600, volume: 0 }),
      bar({ basDt: "20260827", open: 1300, high: 1331, low: 1100, close: 1331, volume: 4193984 }),
    ];
    const flow = buildPriceFlow(stock({ price: 1331 }), bars);

    // 거래정지 중 0을 최저가로 잡으면 안 된다 — 실제 거래가 있었던 날
    // (08-01, 08-27)만 놓고 봐도 최저가는 580원이지, 0원이 아니다.
    expect(flow.yearLow).toEqual({ price: 580, basDt: "20260801" });
    expect(flow.yearHigh).toEqual({ price: 1331, basDt: "20260827" });
    expect(flow.noTradeDayCount).toBe(2);
  });

  it("거래정지 없이 거래가 있는 날만 있으면 noTradeDayCount는 0이다", () => {
    const bars = [
      bar({ basDt: "20260101", high: 100, low: 90, volume: 10 }),
      bar({ basDt: "20260102", high: 120, low: 80, volume: 20 }),
    ];
    const flow = buildPriceFlow(stock(), bars);
    expect(flow.noTradeDayCount).toBe(0);
    expect(flow.yearHigh).toEqual({ price: 120, basDt: "20260102" });
    expect(flow.yearLow).toEqual({ price: 80, basDt: "20260102" });
  });

  it("모든 날이 거래정지(거래량 0)면 최고가·최저가는 계산 불가(null)다", () => {
    const bars = [
      bar({ basDt: "20260101", high: 0, low: 0, close: 500, volume: 0 }),
      bar({ basDt: "20260102", high: 0, low: 0, close: 500, volume: 0 }),
    ];
    const flow = buildPriceFlow(stock(), bars);
    expect(flow.yearHigh).toBeNull();
    expect(flow.yearLow).toBeNull();
    expect(flow.noTradeDayCount).toBe(2);
  });
});

describe("buildUnknownCaveats — '현재 근거만으로 알 수 없는 것' 목록은 프로그램이 정한다", () => {
  function disclosures(overrides: Partial<DisclosureFacts> = {}): DisclosureFacts {
    return {
      source: "금융감독원 OpenDART",
      beginDate: "20250830",
      endDate: "20260830",
      totalCount: 5,
      items: [],
      ...overrides,
    };
  }

  it("공시-가격 인과관계·미래 가격·목표주가·매수매도 판단·공시 제목 한계를 모두 포함한다", () => {
    const caveats = buildUnknownCaveats(disclosures({ totalCount: 0, items: [] }));
    const joined = caveats.join("\n");
    expect(joined).toContain("인과관계");
    expect(joined).toContain("미래 가격");
    expect(joined).toContain("목표주가");
    expect(joined).toContain("매수·매도");
    expect(joined).toContain("공시 제목");
    expect(joined).toContain("DART 원문");
  });

  it("표시된 공시 건수가 전체보다 적을 때만 '최신 N건만 표시했다'를 덧붙인다", () => {
    const items = (n: number) =>
      Array.from({ length: n }, () => ({})) as DisclosureFacts["items"];

    const withMore = buildUnknownCaveats(
      disclosures({ totalCount: 477, items: items(5) })
    );
    expect(withMore.some((c) => c.includes("477건 중 최신 5건"))).toBe(true);

    const withAll = buildUnknownCaveats(
      disclosures({ totalCount: 2, items: items(2) })
    );
    expect(withAll.some((c) => c.includes("건 중 최신"))).toBe(false);
  });
});
