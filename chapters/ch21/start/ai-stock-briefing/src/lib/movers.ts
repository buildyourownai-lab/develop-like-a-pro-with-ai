import type { DailyBar, IndexQuote, RawMarketIndex, RawStockPrice, StockQuote } from "./types";

/**
 * 순위 집계에서 제외할 조건.
 * 실제 응답 2,872건을 확인한 뒤 정한 최소 조건이며 투자 판단 기준이 아니다.
 */
export const RANKING_RULE = {
  markets: ["KOSPI", "KOSDAQ"] as const,
  /** 거래대금 하한 10억원 */
  minTradeValue: 1_000_000_000,
};

export const RANKING_RULE_TEXT = [
  "KOSPI·KOSDAQ 보통주만",
  "우선주·스팩 제외",
  "거래가 없던 종목 제외",
  "거래대금 10억원 이상",
];

const NUMERIC = /^-?[\d.]+$/;

function toNumber(value: string | undefined): number {
  if (!value || !NUMERIC.test(value)) {
    return 0;
  }
  return Number(value);
}

/** 보통주 종목코드는 여섯 자리 숫자이고 끝자리가 0이다. 우선주는 5·7·9·K·L로 끝난다. */
export function isCommonStock(code: string): boolean {
  return /^\d{5}0$/.test(code);
}

export function isSpac(name: string): boolean {
  return name.includes("스팩") || name.includes("기업인수목적");
}

export function toStockQuote(raw: RawStockPrice): StockQuote {
  return {
    baseDate: raw.basDt,
    code: raw.srtnCd,
    name: raw.itmsNm,
    market: raw.mrktCtg,
    close: toNumber(raw.clpr),
    diff: toNumber(raw.vs),
    changeRate: toNumber(raw.fltRt),
    open: toNumber(raw.mkp),
    high: toNumber(raw.hipr),
    low: toNumber(raw.lopr),
    volume: toNumber(raw.trqu),
    tradeValue: toNumber(raw.trPrc),
  };
}

export function toIndexQuote(raw: RawMarketIndex): IndexQuote {
  return {
    baseDate: raw.basDt,
    name: raw.idxNm,
    close: toNumber(raw.clpr),
    diff: toNumber(raw.vs),
    changeRate: toNumber(raw.fltRt),
    open: toNumber(raw.mkp),
    high: toNumber(raw.hipr),
    low: toNumber(raw.lopr),
    tradeValue: toNumber(raw.trPrc),
  };
}

export function toDailyBar(raw: RawStockPrice): DailyBar {
  return {
    date: raw.basDt,
    open: toNumber(raw.mkp),
    high: toNumber(raw.hipr),
    low: toNumber(raw.lopr),
    close: toNumber(raw.clpr),
    volume: toNumber(raw.trqu),
    tradeValue: toNumber(raw.trPrc),
  };
}

/** 순위를 매길 대상만 남긴다. */
export function rankable(quote: StockQuote): boolean {
  if (!(RANKING_RULE.markets as readonly string[]).includes(quote.market)) {
    return false;
  }
  if (!isCommonStock(quote.code) || isSpac(quote.name)) {
    return false;
  }
  if (quote.volume <= 0) {
    return false;
  }
  return quote.tradeValue >= RANKING_RULE.minTradeValue;
}

/** 등락률이 큰 순서와 작은 순서로 각각 상위 몇 개를 뽑는다. */
export function rankMovers(quotes: StockQuote[], size = 5): { gainers: StockQuote[]; losers: StockQuote[]; rankedCount: number } {
  const ranked = quotes.filter(rankable);
  const byRate = [...ranked].sort((a, b) => b.changeRate - a.changeRate || b.tradeValue - a.tradeValue);
  return {
    gainers: byRate.slice(0, size),
    losers: [...byRate].reverse().slice(0, size),
    rankedCount: ranked.length,
  };
}

/** 차트는 과거에서 현재로 흐르므로 날짜 오름차순으로 정렬한다. */
export function toAscendingBars(rows: RawStockPrice[], code: string): DailyBar[] {
  return rows
    .filter((row) => row.srtnCd === code)
    .map(toDailyBar)
    .filter((bar) => bar.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
