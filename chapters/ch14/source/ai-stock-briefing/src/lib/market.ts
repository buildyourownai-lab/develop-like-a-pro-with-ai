import "server-only";
import { getLatestStockPrices, type StockPriceItem } from "./stock-price-api";
import { getLatestIndexQuote } from "./market-index-api";

const MIN_TRADING_VALUE_FOR_RANKING = 1_000_000_000; // 10억원

export const RANKING_CONDITION_TEXT =
  "KOSPI·KOSDAQ 보통주 중, 그날 거래가 있었고 거래대금이 10억원 이상인 종목만 대상으로 합니다 (우선주·스팩 제외).";

export interface RankedStock {
  name: string;
  code: string;
  market: string;
  baseDate: string;
  price: number;
  change: number;
  changeRate: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  tradingValue: number;
}

export interface IndexSummary {
  name: string;
  baseDate: string;
  value: number;
  change: number;
  changeRate: number;
  open: number;
  high: number;
  low: number;
  tradingValue: number;
}

export interface MarketOverview {
  stockBaseDate: string;
  indices: IndexSummary[];
  topGainers: RankedStock[];
  topLosers: RankedStock[];
  rankingCondition: string;
  totalStockCount: number;
  eligibleStockCount: number;
}

// 종목코드(srtnCd) 마지막 자리가 "0"이 아니면 우선주 등 보통주가 아닌
// 발행분이다 — KRX 종목코드 부여 규칙이며, 실제 데이터로도 확인했다
// (예: 삼성전자 005930→005935가 삼성전자우, 현대차 005380→005387이
// 현대차2우B). "…우"로 끝나는 이름만 보는 방식은 "에코글로우"·"이오플로우"
// 같은 보통주를 잘못 걸러내 정확하지 않았다.
function isCommonStock(item: StockPriceItem): boolean {
  return /^\d{5}0$/.test(item.srtnCd);
}

// 스팩(기업인수목적회사)은 종목명에 "스팩"을 반드시 표기하도록 되어 있어
// 이름으로 판단한다.
function isSpac(item: StockPriceItem): boolean {
  return item.itmsNm.includes("스팩") || item.itmsNm.includes("기업인수목적");
}

function isEligibleForRanking(item: StockPriceItem): boolean {
  return (
    (item.mrktCtg === "KOSPI" || item.mrktCtg === "KOSDAQ") &&
    isCommonStock(item) &&
    !isSpac(item) &&
    Number(item.trqu) > 0 &&
    Number(item.trPrc) >= MIN_TRADING_VALUE_FOR_RANKING
  );
}

function toRankedStock(item: StockPriceItem): RankedStock {
  return {
    name: item.itmsNm,
    code: item.srtnCd,
    market: item.mrktCtg,
    baseDate: item.basDt,
    price: Number(item.clpr),
    change: Number(item.vs),
    changeRate: Number(item.fltRt),
    open: Number(item.mkp),
    high: Number(item.hipr),
    low: Number(item.lopr),
    volume: Number(item.trqu),
    tradingValue: Number(item.trPrc),
  };
}

export async function getMarketOverview(): Promise<MarketOverview> {
  const [stockQuotes, kospi, kosdaq] = await Promise.all([
    getLatestStockPrices(5000),
    getLatestIndexQuote("코스피"),
    getLatestIndexQuote("코스닥"),
  ]);

  const eligible = stockQuotes.items.filter(isEligibleForRanking);
  const ranked = eligible.map(toRankedStock);
  const sortedByChangeRate = [...ranked].sort(
    (a, b) => b.changeRate - a.changeRate || b.tradingValue - a.tradingValue
  );

  return {
    stockBaseDate: stockQuotes.basDt,
    indices: [kospi, kosdaq].map((idx) => ({
      name: idx.idxNm,
      baseDate: idx.basDt,
      value: Number(idx.clpr),
      change: Number(idx.vs),
      changeRate: Number(idx.fltRt),
      open: Number(idx.mkp),
      high: Number(idx.hipr),
      low: Number(idx.lopr),
      tradingValue: Number(idx.trPrc),
    })),
    topGainers: sortedByChangeRate.slice(0, 5),
    topLosers: sortedByChangeRate.slice(-5).reverse(),
    rankingCondition: RANKING_CONDITION_TEXT,
    totalStockCount: stockQuotes.totalCount,
    eligibleStockCount: eligible.length,
  };
}
