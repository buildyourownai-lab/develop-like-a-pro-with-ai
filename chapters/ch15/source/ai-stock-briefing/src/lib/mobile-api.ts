import "server-only";

import { getDisclosurePageByStockCode, getRecentDisclosuresByStockCode } from "./dart-disclosure-api";
import { searchListedStocksWithBaseDate } from "./krx-listed-info-api";
import { getMarketOverview } from "./market";
import { getLatestStockPriceByCode, getLatestStockPrices, getYearlyDailyPrices } from "./stock-price-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "./trading-date";

const MOBILE_SCHEMA_VERSION = "1.0" as const;
const NOTE_LABELS: Record<string, string> = {
  유: "유가증권시장", 코: "코스닥시장", 채: "채권상장법인", 넥: "코넥스시장",
  공: "공정거래위원회", 연: "연결부분", 정: "정정 보고", 철: "철회",
};

export class MobileRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "MobileRequestError";
  }
}

export function normalizeMobileStockCode(rawCode: string): string {
  const code = decodeURIComponent(rawCode).trim().toUpperCase();
  if (!/^\d{5}[\dA-Z]$/.test(code)) {
    throw new MobileRequestError("여섯 자리 종목코드로 다시 시도해 주세요.", 400, "INVALID_STOCK_CODE");
  }
  return code;
}

export function toMobileFiling(item: {
  receiptNo: string;
  receiptDate: string;
  reportName: string;
  submitter: string;
  remarks: string;
  dartUrl: string;
}) {
  return {
    receiptNo: item.receiptNo,
    receiptDate: item.receiptDate,
    reportName: item.reportName.trim(),
    filerName: item.submitter.trim(),
    noteLabels: [...item.remarks.trim()].map((mark) => NOTE_LABELS[mark]).filter(Boolean),
    documentUrl: item.dartUrl,
  };
}

export async function mobileMarketResponse() {
  const overview = await getMarketOverview();
  const indexDates = new Set(overview.indices.map((item) => item.baseDate));
  const rankedStock = (item: (typeof overview.topGainers)[number]) => ({
    name: item.name,
    code: item.code,
    market: item.market,
    baseDate: item.baseDate,
    close: item.price,
    diff: item.change,
    changeRate: item.changeRate,
    open: item.open,
    high: item.high,
    low: item.low,
    volume: item.volume,
    tradeValue: item.tradingValue,
  });
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융위원회 주식시세정보·지수시세정보",
    market: {
      priceBaseDate: overview.stockBaseDate,
      indexBaseDate: indexDates.size === 1 ? overview.indices[0]?.baseDate ?? null : null,
      indices: overview.indices.map((item) => ({
        name: item.name,
        baseDate: item.baseDate,
        close: item.value,
        diff: item.change,
        changeRate: item.changeRate,
        open: item.open,
        high: item.high,
        low: item.low,
        tradeValue: item.tradingValue,
      })),
      gainers: overview.topGainers.map(rankedStock),
      losers: overview.topLosers.map(rankedStock),
      universeCount: overview.totalStockCount,
      rankedCount: overview.eligibleStockCount,
    },
  };
}

export async function mobileSearchResponse(rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) throw new MobileRequestError("종목명 또는 종목코드를 입력해 주세요.", 400, "EMPTY_QUERY");
  if (query.length > 50) throw new MobileRequestError("검색어는 50자 이하로 입력해 주세요.", 400, "QUERY_TOO_LONG");
  const result = await searchListedStocksWithBaseDate(query);
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융위원회 KRX상장종목정보",
    query,
    baseDate: result.baseDate,
    hits: result.results.map((item) => ({ ...item, baseDate: result.baseDate })),
  };
}

export async function mobileStockResponse(rawCode: string) {
  const code = normalizeMobileStockCode(rawCode);
  const [stock, market, yearly, listed] = await Promise.all([
    getLatestStockPriceByCode(code),
    getLatestStockPrices(1),
    getYearlyDailyPrices(code),
    searchListedStocksWithBaseDate(code),
  ]);
  if (!stock) throw new MobileRequestError("이 종목의 최근 시세를 찾지 못했습니다.", 404, "STOCK_NOT_FOUND");

  const from = yearly.bars[0]?.basDt ?? yearly.requestedBeginBasDt;
  const to = formatYyyyMmDd(new Date());
  let filings:
    | { state: "ready"; corpName: string; from: string; to: string; totalCount: number; recent: ReturnType<typeof toMobileFiling>[] }
    | { state: "none"; totalCount: 0; recent: never[] }
    | { state: "error"; totalCount: 0; recent: never[] } = { state: "none", totalCount: 0, recent: [] };
  const corpName = listed.results.find((item) => item.code === code)?.corpName;
  if (corpName) {
    try {
      const page = await getRecentDisclosuresByStockCode(code, from, to);
      filings = { state: "ready", corpName, from, to, totalCount: page.totalCount, recent: page.items.map(toMobileFiling) };
    } catch {
      filings = { state: "error", totalCount: 0, recent: [] };
    }
  }

  const item = stock.item;
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    sources: ["금융위원회 주식시세정보", "금융감독원 전자공시시스템(OpenDART)"],
    marketBaseDate: market.basDt,
    quote: {
      baseDate: stock.basDt,
      code: item.srtnCd,
      name: item.itmsNm,
      market: item.mrktCtg,
      close: Number(item.clpr),
      diff: Number(item.vs),
      changeRate: Number(item.fltRt),
      open: Number(item.mkp),
      high: Number(item.hipr),
      low: Number(item.lopr),
      volume: Number(item.trqu),
      tradeValue: Number(item.trPrc),
    },
    bars: yearly.bars.map((bar) => ({
      date: bar.basDt,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      tradeValue: bar.tradingValue,
    })),
    filings,
  };
}

export async function mobileFilingsResponse(rawCode: string, rawPage: string | null) {
  const code = normalizeMobileStockCode(rawCode);
  const parsed = Number(rawPage ?? "1");
  const pageNo = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  const listed = await searchListedStocksWithBaseDate(code);
  const corpName = listed.results.find((item) => item.code === code)?.corpName;
  if (!corpName) throw new MobileRequestError("이 종목에 연결된 공시 회사를 찾지 못했습니다.", 404, "DART_CORP_NOT_FOUND");
  const to = formatYyyyMmDd(new Date());
  const from = subtractDaysYyyyMmDd(to, 365);
  const page = await getDisclosurePageByStockCode(code, from, to, pageNo, { pageCount: 20 });
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융감독원 전자공시시스템(OpenDART) 공시검색",
    code,
    corpName,
    from,
    to,
    pageNo: page.pageNo,
    totalCount: page.totalCount,
    totalPage: page.totalPage,
    filings: page.items.map(toMobileFiling),
  };
}

export function mobileErrorResponse(caught: unknown): Response {
  if (caught instanceof MobileRequestError) {
    return Response.json({ error: caught.message, code: caught.code }, { status: caught.status });
  }
  console.error("mobile_api_error", { name: caught instanceof Error ? caught.name : typeof caught });
  return Response.json(
    { error: "서버가 공식 자료를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", code: "UPSTREAM_FAILURE" },
    { status: 502 }
  );
}
