import type { BriefingEvidencePacket, DailyBar, IndexQuote, StockQuote } from "./types";

const SHORT_HISTORY_DAYS = 200;

/** AI가 아니라 프로그램이 일봉에서 확정하는 가격 구간 사실. */
export function summarizePriceHistory(bars: DailyBar[]): BriefingEvidencePacket["priceHistory"] {
  if (bars.length === 0) {
    throw new Error("가격 흐름을 계산할 거래일 자료가 없습니다.");
  }

  const first = bars[0];
  const last = bars[bars.length - 1];
  const closeChange = last.close - first.close;
  const highestHigh = Math.max(...bars.map((bar) => bar.high));
  const lowestLow = Math.min(...bars.map((bar) => bar.low));
  return {
    from: first.date,
    to: last.date,
    tradingDays: bars.length,
    startClose: first.close,
    endClose: last.close,
    highestHigh,
    lowestLow,
    closeChange,
    closeChangeRate: first.close === 0 ? 0 : (closeChange / first.close) * 100,
    rangePositionRate:
      highestHigh === lowestLow ? 100 : ((last.close - lowestLow) / (highestHigh - lowestLow)) * 100,
    isShortHistory: bars.length < SHORT_HISTORY_DAYS,
  };
}

function sameMovementDirection(first: number, second: number): boolean {
  return first !== 0 && second !== 0 && Math.sign(first) === Math.sign(second);
}

/** AI가 배수를 만들지 않도록 같은 방향의 등락률 배수를 프로그램이 한 자리까지 확정한다. */
export function movementRateRatio(stockRate: number, indexRate: number): number | null {
  if (!sameMovementDirection(stockRate, indexRate)) return null;
  return Math.round((Math.abs(stockRate) / Math.abs(indexRate)) * 10) / 10;
}

/** 같은 시작일·종료일의 종목과 시장 지수 변화를 프로그램이 비교한다. */
export function summarizeMarketComparison(
  quote: Pick<StockQuote, "changeRate">,
  history: BriefingEvidencePacket["priceHistory"],
  indices: IndexQuote[]
): BriefingEvidencePacket["marketComparison"] {
  const first = indices.find((index) => index.baseDate === history.from);
  const last = indices.find((index) => index.baseDate === history.to);
  if (!first || !last || first.name !== last.name || first.close === 0) return null;
  const indexChangeRate = ((last.close - first.close) / first.close) * 100;
  return {
    indexName: last.name,
    from: history.from,
    to: history.to,
    indexStartClose: first.close,
    indexEndClose: last.close,
    stockChangeRate: history.closeChangeRate,
    indexChangeRate,
    relativeChangeRate: history.closeChangeRate - indexChangeRate,
    changeRateRatio: movementRateRatio(history.closeChangeRate, indexChangeRate),
    latestStockChangeRate: quote.changeRate,
    latestIndexChangeRate: last.changeRate,
    latestRelativeChangeRate: quote.changeRate - last.changeRate,
    latestChangeRateRatio: movementRateRatio(quote.changeRate, last.changeRate),
  };
}
