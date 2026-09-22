import "server-only";
import { fetchFscPage } from "./fsc-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "./trading-date";

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

export async function getLatestIndexQuote(
  idxNm: "코스피" | "코스닥"
): Promise<MarketIndexItem> {
  const today = formatYyyyMmDd(new Date());
  const { items } = await fetchFscPage<MarketIndexItem>(
    MARKET_INDEX_ENDPOINT,
    { numOfRows: 1, pageNo: 1, idxNm, beginBasDt: subtractDaysYyyyMmDd(today, 20) },
    "금융위원회 지수시세정보"
  );
  if (!items[0]) throw new Error("최근 20일 안에 제공된 지수시세 자료를 찾지 못했습니다.");
  return items[0];
}
