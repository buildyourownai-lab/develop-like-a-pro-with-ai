import "server-only";
import { fetchFscPage } from "./fsc-api";
import { formatYyyyMmDd, findLatestTradingDate } from "./trading-date";
import { withCache, CACHE_TTL_SECONDS } from "./api-cache";

const MARKET_INDEX_ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex";

export type MarketIndexItem = {
  basDt: string;
  idxNm: string;
  clpr: string;
  vs: string;
  fltRt: string;
  mkp: string;
  hipr: string;
  lopr: string;
  trPrc: string;
};

type MarketIndexApiResult = {
  totalCount: number;
  items: MarketIndexItem[];
};

async function fetchMarketIndex(
  basDt: string,
  idxNm: string
): Promise<MarketIndexApiResult> {
  return fetchFscPage<MarketIndexItem>(
    MARKET_INDEX_ENDPOINT,
    { numOfRows: 1, pageNo: 1, basDt, idxNm },
    "금융위원회 지수시세정보"
  );
}

export async function getLatestIndexQuote(
  idxNm: "코스피" | "코스닥"
): Promise<MarketIndexItem> {
  const today = formatYyyyMmDd(new Date());
  const basDt = await withCache(
    `latest-trading-date:market-index:${idxNm}`,
    CACHE_TTL_SECONDS.latestTradingDate,
    () =>
      findLatestTradingDate(
        async (candidate) =>
          (await fetchMarketIndex(candidate, idxNm)).totalCount,
        today
      )
  );
  const { items } = await withCache(
    `market-index:${idxNm}:${basDt}`,
    CACHE_TTL_SECONDS.confirmedMarketData,
    () => fetchMarketIndex(basDt, idxNm)
  );
  return items[0];
}
