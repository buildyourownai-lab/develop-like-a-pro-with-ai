import "server-only";

import {
  FSC_ENDPOINT,
  fscFetch,
} from "./fsc";
import {
  FSC_DAILY_SNAPSHOT_TTL_SECONDS,
  FSC_LATEST_DISCOVERY_TTL_SECONDS,
} from "./fsc-cache-policy";
import { recordChapter12Metric } from "./chapter12-metrics";
import { rankMovers, toIndexQuote, toStockQuote } from "./movers";
import { seoulToday, shiftDays } from "./trading-date";
import type { IndexQuote, MarketSnapshot, RawMarketIndex, RawStockPrice } from "./types";

/** 지수시세정보의 idxNm은 정확히 일치해야 한다. */
const INDEX_NAMES = ["코스피", "코스닥"] as const;

/** 한 번에 받을 수 있는 행 수. 거래일 하루는 2,900건 정도다. */
const PAGE_SIZE = 4000;

/** 최근 며칠까지 뒤로 훑어볼지. 주말·연휴가 겹쳐도 충분한 길이로 잡는다. */
const LOOKBACK_DAYS = 20;
const INDEX_HISTORY_ROWS = 400;

/**
 * 가장 최근에 제공된 거래일을 찾는다.
 * 이 API는 기준일 내림차순으로 응답하므로, 최근 며칠 구간을 열고 첫 줄만 읽으면 된다.
 * 오늘 날짜로 바로 조회하면 장이 끝나기 전이거나 휴장일일 때 0건이 나온다.
 */
export async function resolveLatestPriceBaseDate(): Promise<string> {
  const today = seoulToday();
  const { items } = await fscFetch<RawStockPrice>(FSC_ENDPOINT.stockPrice, {
    beginBasDt: shiftDays(today, -LOOKBACK_DAYS),
    numOfRows: 1,
    pageNo: 1,
  }, { databaseTtlSeconds: FSC_LATEST_DISCOVERY_TTL_SECONDS });
  if (items.length === 0) {
    throw new Error(`최근 ${LOOKBACK_DAYS}일 안에 제공된 주식시세 자료를 찾지 못했습니다.`);
  }
  return items[0].basDt;
}

/** 특정 거래일의 전 종목 시세를 모두 받는다. */
async function fetchQuotesOn(baseDate: string): Promise<RawStockPrice[]> {
  const first = await fscFetch<RawStockPrice>(FSC_ENDPOINT.stockPrice, {
    basDt: baseDate,
    numOfRows: PAGE_SIZE,
    pageNo: 1,
  }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS });

  const pageCount = Math.ceil(first.totalCount / PAGE_SIZE);
  if (pageCount <= 1) {
    return first.items;
  }

  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      fscFetch<RawStockPrice>(FSC_ENDPOINT.stockPrice, {
        basDt: baseDate,
        numOfRows: PAGE_SIZE,
        pageNo: index + 2,
      }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS })
    )
  );

  return [first.items, ...rest.map((page) => page.items)].flat();
}

/**
 * 지수는 주식시세와 다른 API에서 온다.
 * 두 API의 기준일이 다를 수 있으므로 지수 기준일을 따로 받아 그대로 보여 준다.
 */
async function fetchLatestIndices(): Promise<IndexQuote[]> {
  const today = seoulToday();
  const results = await Promise.all(
    INDEX_NAMES.map((idxNm) =>
      fscFetch<RawMarketIndex>(FSC_ENDPOINT.marketIndex, {
        idxNm,
        beginBasDt: shiftDays(today, -LOOKBACK_DAYS),
        numOfRows: 1,
        pageNo: 1,
      }, { databaseTtlSeconds: FSC_LATEST_DISCOVERY_TTL_SECONDS })
    )
  );
  const started = performance.now();
  const indices = results.flatMap((page) => page.items.map(toIndexQuote));
  recordChapter12Metric({
    service: "server",
    operation: "index-transform",
    durationMs: performance.now() - started,
  });
  return indices;
}

/** 종목 가격 구간과 같은 날짜의 시장 지수 흐름을 비교하기 위한 일별 지수 자료. */
export async function fetchIndexHistory(
  indexName: (typeof INDEX_NAMES)[number],
  from: string,
  to: string
): Promise<IndexQuote[]> {
  const { items } = await fscFetch<RawMarketIndex>(FSC_ENDPOINT.marketIndex, {
    idxNm: indexName,
    beginBasDt: from,
    endBasDt: shiftDays(to, 1),
    numOfRows: INDEX_HISTORY_ROWS,
    pageNo: 1,
  }, { databaseTtlSeconds: FSC_DAILY_SNAPSHOT_TTL_SECONDS });
  return items
    .filter((item) => item.idxNm === indexName)
    .map(toIndexQuote)
    .sort((a, b) => a.baseDate.localeCompare(b.baseDate));
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const priceBaseDate = await resolveLatestPriceBaseDate();
  const [rawQuotes, indices] = await Promise.all([fetchQuotesOn(priceBaseDate), fetchLatestIndices()]);

  const transformStarted = performance.now();
  const quotes = rawQuotes.map(toStockQuote);
  recordChapter12Metric({
    service: "server",
    operation: "market-quote-transform",
    durationMs: performance.now() - transformStarted,
  });
  const rankingStarted = performance.now();
  const { gainers, losers, rankedCount } = rankMovers(quotes);
  recordChapter12Metric({
    service: "server",
    operation: "market-ranking",
    durationMs: performance.now() - rankingStarted,
  });

  const indexDates = new Set(indices.map((index) => index.baseDate));

  return {
    priceBaseDate,
    indexBaseDate: indexDates.size === 1 ? [...indexDates][0] : null,
    indices,
    gainers,
    losers,
    universeCount: quotes.length,
    rankedCount,
  };
}
