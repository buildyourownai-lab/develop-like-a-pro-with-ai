import "server-only";
import { fetchFscPage } from "./fsc-api";
import {
  formatYyyyMmDd,
  findLatestTradingDate,
  subtractDaysYyyyMmDd,
} from "./trading-date";
import { withCache, CACHE_TTL_SECONDS } from "./api-cache";

const STOCK_PRICE_ENDPOINT =
  "https://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService/getStockPriceInfo";

export type StockPriceItem = {
  basDt: string;
  srtnCd: string;
  isinCd: string;
  itmsNm: string;
  mrktCtg: string;
  clpr: string;
  vs: string;
  fltRt: string;
  mkp: string;
  hipr: string;
  lopr: string;
  trqu: string;
  trPrc: string;
  lstgStCnt: string;
  mrktTotAmt: string;
};

type StockPriceApiResult = {
  totalCount: number;
  items: StockPriceItem[];
};

export async function fetchStockPriceInfo(
  basDt: string | undefined,
  numOfRows = 5,
  pageNo = 1,
  extra: Record<string, string> = {}
): Promise<StockPriceApiResult> {
  return fetchFscPage<StockPriceItem>(
    STOCK_PRICE_ENDPOINT,
    { numOfRows, pageNo, ...(basDt ? { basDt } : {}), ...extra },
    "금융위원회 주식시세정보"
  );
}

export async function getLatestStockPrices(numOfRows = 5): Promise<{
  basDt: string;
  totalCount: number;
  items: StockPriceItem[];
}> {
  const today = formatYyyyMmDd(new Date());
  const basDt = await withCache(
    "latest-trading-date:stock-price",
    CACHE_TTL_SECONDS.latestTradingDate,
    () =>
      findLatestTradingDate(
        async (candidate) =>
          (await fetchStockPriceInfo(candidate, 1)).totalCount,
        today
      )
  );
  const { totalCount, items } = await withCache(
    `stock-price:top:${basDt}:${numOfRows}`,
    CACHE_TTL_SECONDS.confirmedMarketData,
    () => fetchStockPriceInfo(basDt, numOfRows)
  );
  return { basDt, totalCount, items };
}

// 특정 종목은 시장 전체와 기준일이 다를 수 있어(신규 상장, 거래정지 등),
// 시장 전체 기준일과 별개로 이 종목만 따로 최근 거래일을 찾는다.
export async function getLatestStockPriceByCode(
  code: string
): Promise<{ basDt: string; item: StockPriceItem } | null> {
  const today = formatYyyyMmDd(new Date());
  let basDt: string;
  try {
    basDt = await withCache(
      `latest-trading-date:stock-price:${code}`,
      CACHE_TTL_SECONDS.latestTradingDate,
      () =>
        findLatestTradingDate(
          async (candidate) =>
            (await fetchStockPriceInfo(candidate, 1, 1, { likeSrtnCd: code }))
              .totalCount,
          today
        )
    );
  } catch {
    return null;
  }
  const { items } = await withCache(
    `stock-price:item:${code}:${basDt}`,
    CACHE_TTL_SECONDS.confirmedMarketData,
    () => fetchStockPriceInfo(basDt, 1, 1, { likeSrtnCd: code })
  );
  const exact = items.find((it) => it.srtnCd === code);
  return exact ? { basDt, item: exact } : null;
}

export interface DailyPriceBar {
  basDt: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tradingValue: number;
}

export interface YearlyDailyPrices {
  requestedBeginBasDt: string;
  bars: DailyPriceBar[];
}

// 최근 1년치 일별 시세를 날짜 오름차순으로 돌려준다. basDt 하나가 아니라
// beginBasDt~endBasDt 기간으로 조회하므로, 앞의 최근 거래일 찾기와는 별개다.
// requestedBeginBasDt를 같이 돌려주는 이유: 최근 상장 종목처럼 실제 데이터가
// 1년치보다 짧을 수 있어, 호출한 쪽에서 "요청한 시작일"과 "실제 첫 거래일"을
// 비교해 1년을 채우지 못했다는 것을 알 수 있게 한다.
export async function getYearlyDailyPrices(
  code: string
): Promise<YearlyDailyPrices> {
  const today = formatYyyyMmDd(new Date());
  const end = await findLatestTradingDate(
    async (candidate) => (await fetchStockPriceInfo(candidate, 1)).totalCount,
    today
  );
  const begin = subtractDaysYyyyMmDd(end, 365);
  const { items } = await withCache(
    `yearly-prices:${code}:${end}`,
    CACHE_TTL_SECONDS.confirmedMarketData,
    () =>
      fetchStockPriceInfo(undefined, 400, 1, {
        likeSrtnCd: code,
        beginBasDt: begin,
    // 공공데이터포털의 기간 끝은 미포함이므로 다음 날을 보내 기준일을 포함한다.
    endBasDt: subtractDaysYyyyMmDd(end, -1),
      })
  );

  const bars = items
    .filter((it) => it.srtnCd === code)
    .map((it) => ({
      basDt: it.basDt,
      open: Number(it.mkp),
      high: Number(it.hipr),
      low: Number(it.lopr),
      close: Number(it.clpr),
      volume: Number(it.trqu),
      tradingValue: Number(it.trPrc),
    }))
    .sort((a, b) => a.basDt.localeCompare(b.basDt));

  return { requestedBeginBasDt: begin, bars };
}
