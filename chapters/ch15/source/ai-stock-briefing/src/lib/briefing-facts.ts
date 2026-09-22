import type { DailyPriceBar } from "./stock-price-api";
import type { DisclosureItem, DisclosureTypeCount, DisclosureTypeCode } from "./dart-disclosure-api";
import { formatChangeRate } from "./format";

export interface StockQuoteFact {
  name: string;
  code: string;
  market: string;
  baseDate: string;
  price: number;
  change: number;
  changeRate: number;
}

export interface IndexQuoteFact {
  name: string;
  baseDate: string;
  value: number;
  change: number;
  changeRate: number;
}

// "훨씬 큰 폭"·"큰 폭" 같은 구간 나누기는 금융위원회나 거래소가 정한 기준이
// 아니라 이 앱이 읽기 쉽게 임의로 나눈 것이다 — 정확한 숫자(deltaPp)를 항상
// 함께 보여줘서, 이 말이 추측이 아니라 그 숫자에 대한 설명이라는 걸 알 수
// 있게 한다.
export type ComparisonMagnitude =
  | "훨씬 큰 폭"
  | "큰 폭"
  | "약간"
  | "비슷한 수준";

export interface MarketComparisonItem {
  indexName: string;
  indexBaseDate: string;
  indexChangeRate: number;
  stockChangeRate: number;
  // 종목 등락률 - 지수 등락률(%p). Gemini에게 계산을 맡기지 않고 프로그램이
  // 직접 계산한 값이다.
  deltaPp: number;
  magnitude: ComparisonMagnitude;
  // 이 종목이 실제로 속한 시장(KOSPI/KOSDAQ)의 지수인지 여부.
  isOwnMarket: boolean;
}

export interface PriceFlowFact {
  source: string;
  currentPrice: number;
  currentChangeRate: number;
  currentBaseDate: string;
  periodStartPrice: number;
  periodStartDate: string;
  periodEndPrice: number;
  periodEndDate: string;
  // 기간 시작 종가 대비 변동률. 시작 종가가 0이라 계산할 수 없으면 null.
  periodChangeRate: number | null;
  // 실제 거래가 있었던 날만으로 계산한 값. 거래가 있었던 날이 하나도
  // 없으면 null.
  yearHigh: { price: number; basDt: string } | null;
  yearLow: { price: number; basDt: string } | null;
  // 거래정지 등으로 시가·고가·저가·거래량이 0으로 채워진 날의 수.
  noTradeDayCount: number;
  tradingDayCount: number;
  currentVolume: number;
}

export interface DisclosureFacts {
  source: string;
  beginDate: string;
  endDate: string;
  totalCount: number;
  items: DisclosureItem[];
  typeCounts?: DisclosureTypeCount[];
  representative?: Array<DisclosureItem & { disclosureType: DisclosureTypeCode; disclosureTypeLabel: string; selectionReason: string }>;
}

export interface BriefingFacts {
  generatedAt: string;
  stock: StockQuoteFact;
  marketComparison: MarketComparisonItem[];
  priceFlow: PriceFlowFact;
  disclosures: DisclosureFacts;
  // 이 자료만으로는 알 수 없는 것 — 프로그램이 정해 둔 목록이다. AI에게
  // 만들게 하지 않는다.
  unknownCaveats: string[];
}

function marketToIndexName(market: string): "코스피" | "코스닥" | null {
  if (market === "KOSPI") return "코스피";
  if (market === "KOSDAQ") return "코스닥";
  return null;
}

function magnitudeLabel(deltaPp: number): ComparisonMagnitude {
  const abs = Math.abs(deltaPp);
  if (abs >= 15) return "훨씬 큰 폭";
  if (abs >= 5) return "큰 폭";
  if (abs >= 1) return "약간";
  return "비슷한 수준";
}

export function buildMarketComparison(
  stock: StockQuoteFact,
  indices: IndexQuoteFact[]
): MarketComparisonItem[] {
  const ownIndexName = marketToIndexName(stock.market);
  return indices.map((idx) => {
    const deltaPp = Math.round((stock.changeRate - idx.changeRate) * 100) / 100;
    return {
      indexName: idx.name,
      indexBaseDate: idx.baseDate,
      indexChangeRate: idx.changeRate,
      stockChangeRate: stock.changeRate,
      deltaPp,
      magnitude: magnitudeLabel(deltaPp),
      isOwnMarket: idx.name === ownIndexName,
    };
  });
}

// 최근 1년 일별 시세(차트와 같은 데이터)에서 기간 시작 대비 등락률, 기간
// 중 최고가·최저가를 프로그램이 직접 계산한다 — Gemini에게 원본 수치를
// 던져주고 계산을 맡기지 않는다.
//
// 거래정지 기간에는 금융위원회 API가 그날 행을 지우지 않고 시가·고가·저가·
// 거래량을 0으로, 종가만 정지 직전 종가로 채워서 돌려준다 — 실제로 확인함
// (파루 043200, 2026-08-04~08-26 거래정지 구간). 이 0을 그대로 최저가로
// 쓰면 실제로 없었던 "0원 거래"를 사실처럼 만들게 되므로, 최고가·최저가는
// 거래량이 있는(실제 거래가 있었던) 날만으로 계산한다.
export function buildPriceFlow(
  stock: StockQuoteFact,
  bars: DailyPriceBar[]
): PriceFlowFact {
  const source = "금융위원회 주식시세정보(일별)";
  if (bars.length === 0) {
    return {
      source,
      currentPrice: stock.price,
      currentChangeRate: stock.changeRate,
      currentBaseDate: stock.baseDate,
      periodStartPrice: stock.price,
      periodStartDate: stock.baseDate,
      periodEndPrice: stock.price,
      periodEndDate: stock.baseDate,
      periodChangeRate: null,
      yearHigh: null,
      yearLow: null,
      noTradeDayCount: 0,
      tradingDayCount: 0,
      currentVolume: 0,
    };
  }

  const first = bars[0];
  const last = bars[bars.length - 1];
  const tradedBars = bars.filter((b) => b.volume > 0);
  const noTradeDayCount = bars.length - tradedBars.length;

  let yearHigh: PriceFlowFact["yearHigh"] = null;
  let yearLow: PriceFlowFact["yearLow"] = null;
  if (tradedBars.length > 0) {
    let high = tradedBars[0];
    let low = tradedBars[0];
    for (const bar of tradedBars) {
      if (bar.high > high.high) high = bar;
      if (bar.low < low.low) low = bar;
    }
    yearHigh = { price: high.high, basDt: high.basDt };
    yearLow = { price: low.low, basDt: low.basDt };
  }

  const periodChangeRate =
    first.close !== 0
      ? Math.round(((last.close - first.close) / first.close) * 10000) / 100
      : null;

  return {
    source,
    currentPrice: stock.price,
    currentChangeRate: stock.changeRate,
    currentBaseDate: stock.baseDate,
    periodStartPrice: first.close,
    periodStartDate: first.basDt,
    periodEndPrice: last.close,
    periodEndDate: last.basDt,
    periodChangeRate,
    yearHigh,
    yearLow,
    noTradeDayCount,
    tradingDayCount: bars.length,
    currentVolume: last.volume,
  };
}

// 시장 대비 등락률 차이를 사람이 읽기 좋은 한 문장으로 만든다. deltaPp·
// magnitude 모두 프로그램이 이미 계산해 둔 값이라, 이 함수는 그 값을
// 문장 형태로 바꿔 쓰기만 한다 — 새로 계산하지 않는다.
export function describeMarketComparison(
  item: MarketComparisonItem,
  stockName: string
): string {
  const indexPart = `${item.indexName} 등락률(${formatChangeRate(item.indexChangeRate)})`;
  const stockPart = `${stockName} 등락률(${formatChangeRate(item.stockChangeRate)})`;
  const diffPart = `차이 ${formatChangeRate(item.deltaPp)}p`;

  if (item.magnitude === "비슷한 수준") {
    return `${indexPart}과 ${stockPart}은 비슷한 수준이다(${diffPart}).`;
  }
  const direction = item.deltaPp > 0 ? "높다" : "낮다";
  return `${indexPart} 대비 ${stockPart}은 ${item.magnitude}으로 ${direction}(${diffPart}).`;
}

// "이 자료만으로는 알 수 없는 것" 목록은 AI가 즉석에서 만들지 않고, 프로그램이
// 이 브리핑에 실제로 무엇을 넣었는지(또는 넣지 않았는지)를 보고 정해 둔다.
export function buildUnknownCaveats(disclosures: DisclosureFacts): string[] {
  const caveats = [
    "공시와 주가 변동 사이의 인과관계는 이 자료만으로 확인할 수 없다 — 같은 기간에 있었던 사실만 나열한 것이다.",
    "미래 가격은 이 자료로 알 수 없다. 이 브리핑은 과거·현재 시세와 공시만 정리한 것이다.",
    "목표주가는 이 자료에 없다. 이 브리핑은 목표주가를 계산하거나 제시하지 않는다.",
    "매수·매도 판단은 이 자료로 할 수 없다. 이 브리핑은 투자 조언이 아니다.",
    "공시 제목만으로 공시 내용 전체를 알 수 없다. 자세한 내용은 아래 링크로 DART 원문에서 확인해야 한다.",
    "향후 실적 전망, 사업 전략, 경영진 발언은 이 자료에 포함되어 있지 않다.",
    "업종·경쟁사 비교, 애널리스트 리포트, 언론 보도 같은 외부 자료는 쓰지 않았다.",
  ];
  if (disclosures.totalCount > disclosures.items.length) {
    caveats.push(
      `최근 1년 공시 ${disclosures.totalCount}건 중 최신 ${disclosures.items.length}건만 표시했다.`
    );
  }
  return caveats;
}
