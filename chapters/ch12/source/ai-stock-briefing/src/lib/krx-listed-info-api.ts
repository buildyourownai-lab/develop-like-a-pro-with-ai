import "server-only";
import { fetchFscPage } from "./fsc-api";
import { formatYyyyMmDd, findLatestTradingDate } from "./trading-date";
import { withCache, CACHE_TTL_SECONDS } from "./api-cache";

const KRX_LISTED_INFO_ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetKrxListedInfoService/getItemInfo";

type ListedStockItem = {
  basDt: string;
  srtnCd: string; // "A005930"처럼 앞에 A가 붙는다.
  isinCd: string;
  itmsNm: string;
  mrktCtg: string;
  crno: string;
  corpNm: string;
};

type ListedInfoApiResult = { totalCount: number; items: ListedStockItem[] };

async function fetchListedInfo(
  basDt: string,
  extra: Record<string, string>
): Promise<ListedInfoApiResult> {
  return fetchFscPage<ListedStockItem>(
    KRX_LISTED_INFO_ENDPOINT,
    { numOfRows: 20, pageNo: 1, basDt, ...extra },
    "KRX상장종목정보"
  );
}

async function findListedInfoBaseDate(): Promise<string> {
  const today = formatYyyyMmDd(new Date());
  return withCache(
    "latest-trading-date:listed-info",
    CACHE_TTL_SECONDS.latestTradingDate,
    () =>
      findLatestTradingDate(
        async (candidate) => (await fetchListedInfo(candidate, {})).totalCount,
        today
      )
  );
}

// KRX상장종목정보의 srtnCd는 "A005930" 형태지만, 주식시세정보는 "005930"
// 형태를 쓴다. 화면과 URL에서는 뒤쪽(A 없는) 형태를 종목코드로 쓴다.
function normalizeStockCode(srtnCd: string): string {
  return srtnCd.replace(/^A/, "");
}

export interface StockSearchResult {
  code: string;
  name: string;
  market: string;
  corpName: string;
}

function toSearchResult(item: ListedStockItem): StockSearchResult {
  return {
    code: normalizeStockCode(item.srtnCd),
    name: item.itmsNm,
    market: item.mrktCtg,
    corpName: item.corpNm,
  };
}

export async function searchListedStocks(
  query: string
): Promise<StockSearchResult[]> {
  return (await searchListedStocksWithBaseDate(query)).results;
}

export async function searchListedStocksWithBaseDate(
  query: string
): Promise<{ baseDate: string; results: StockSearchResult[] }> {
  const trimmed = query.trim();
  if (!trimmed) return { baseDate: "", results: [] };

  const basDt = await findListedInfoBaseDate();
  const isCodeQuery = /^\d+$/.test(trimmed);
  const { items } = await withCache(
    `listed-info:${basDt}:${isCodeQuery ? "code" : "name"}:${trimmed}`,
    CACHE_TTL_SECONDS.confirmedMarketData,
    () =>
      fetchListedInfo(
        basDt,
        isCodeQuery ? { likeSrtnCd: trimmed } : { likeItmsNm: trimmed }
      )
  );
  const seen = new Set<string>();
  const results = items
    .filter((item) => {
      if (seen.has(item.isinCd)) return false;
      seen.add(item.isinCd);
      return true;
    })
    .map(toSearchResult)
    .sort((a, b) => a.name.localeCompare(b.name, "ko-KR"));
  return { baseDate: basDt, results };
}
