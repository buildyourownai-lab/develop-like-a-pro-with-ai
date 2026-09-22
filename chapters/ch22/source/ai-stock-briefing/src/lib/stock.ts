import "server-only";

import {
  FSC_ENDPOINT,
  fscFetch,
} from "./fsc";
import { FSC_DAILY_SNAPSHOT_TTL_SECONDS } from "./fsc-cache-policy";
import { recordChapter12Metric } from "./chapter12-metrics";
import { toAscendingBars, toStockQuote } from "./movers";
import { seoulToday, shiftDays, shiftYears } from "./trading-date";
import type { DailyBar, RawListedItem, RawStockPrice, SearchHit, StockQuote } from "./types";

const LOOKBACK_DAYS = 20;
const SEARCH_LIMIT = 20;

/** 거래일 1년은 240~250일이다. 여유를 두고 한 번에 받는다. */
const HISTORY_ROWS = 400;

/**
 * 상장종목정보의 종목코드는 "A000660"처럼 A가 붙는다.
 * 주식시세정보는 "000660"으로 준다. 같은 종목인데 표기가 달라 한쪽으로 맞춰 둔다.
 * 화면에는 사람이 아는 여섯 자리 종목코드만 보여 주고, 표기 차이는 여기서 흡수한다.
 */
export function normalizeCode(code: string): string {
  return code.replace(/^A/, "");
}

export function isValidCode(code: string): boolean {
  return /^\d{5}[\dA-Z]$/.test(code);
}

/** KRX상장종목정보에서 가장 최근 기준일을 찾는다. 주식시세정보의 기준일과 다를 수 있다. */
async function resolveLatestListedBaseDate(): Promise<string> {
  const today = seoulToday();
  const { items } = await fscFetch<RawListedItem>(FSC_ENDPOINT.listedInfo, {
    beginBasDt: shiftDays(today, -LOOKBACK_DAYS),
    numOfRows: 1,
    pageNo: 1,
  }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS });
  if (items.length === 0) {
    throw new Error(`최근 ${LOOKBACK_DAYS}일 안에 제공된 상장종목 자료를 찾지 못했습니다.`);
  }
  return items[0].basDt;
}

/** 종목명이나 종목코드로 상장종목을 찾는다. */
export async function searchStocks(rawQuery: string): Promise<{ baseDate: string; hits: SearchHit[] }> {
  const query = rawQuery.trim();
  if (query.length === 0) {
    return { baseDate: "", hits: [] };
  }

  const baseDate = await resolveLatestListedBaseDate();
  const apiQuery = query.toUpperCase();
  const byCode = /^[\dA-Za-z]{2,6}$/.test(query) && /\d/.test(query);
  const { items } = await fscFetch<RawListedItem>(FSC_ENDPOINT.listedInfo, {
    basDt: baseDate,
    numOfRows: 200,
    pageNo: 1,
    ...(byCode ? { likeSrtnCd: normalizeCode(apiQuery) } : { likeItmsNm: apiQuery }),
  }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS });

  const seen = new Set<string>();
  const hits: SearchHit[] = [];
  for (const item of items) {
    if (seen.has(item.isinCd)) {
      continue;
    }
    seen.add(item.isinCd);
    hits.push({
      code: normalizeCode(item.srtnCd),
      name: item.itmsNm,
      market: item.mrktCtg,
      corpName: item.corpNm,
      baseDate: item.basDt,
    });
  }

  const needle = query.toLowerCase();
  hits.sort((a, b) => score(a, needle) - score(b, needle) || a.name.localeCompare(b.name, "ko-KR"));
  return { baseDate, hits: hits.slice(0, SEARCH_LIMIT) };
}

/** 정확히 일치하는 이름·코드를 먼저 보여 준다. */
function score(hit: SearchHit, needle: string): number {
  const name = hit.name.toLowerCase();
  if (hit.code.toLowerCase() === needle || name === needle) return 0;
  if (name.startsWith(needle)) return 1;
  return 2;
}

/**
 * 한 종목의 최근 1년 일별 시세를 받는다.
 * endBasDt는 그 날짜를 포함하지 않으므로 기준일 다음 날을 넣어야 기준일까지 들어온다.
 */
export async function fetchStockHistory(
  code: string,
  baseDate: string
): Promise<{ quote: StockQuote | null; bars: DailyBar[] }> {
  const { items } = await fscFetch<RawStockPrice>(FSC_ENDPOINT.stockPrice, {
    likeSrtnCd: code,
    beginBasDt: shiftYears(baseDate, -1),
    endBasDt: shiftDays(baseDate, 1),
    numOfRows: HISTORY_ROWS,
    pageNo: 1,
  }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS });

  const started = performance.now();
  const exact = items.filter((item) => item.srtnCd === code);
  const bars = toAscendingBars(exact, code);
  const latest = exact.reduce<RawStockPrice | null>(
    (best, item) => (best === null || item.basDt > best.basDt ? item : best),
    null
  );

  const result = { quote: latest ? toStockQuote(latest) : null, bars };
  recordChapter12Metric({
    service: "server",
    operation: "stock-history-transform",
    durationMs: performance.now() - started,
  });
  return result;
}
