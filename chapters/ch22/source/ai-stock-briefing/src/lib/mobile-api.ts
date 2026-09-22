import "server-only";

import { fetchFilings, findCorpByStockCode } from "./dart";
import { getMarketSnapshot, resolveLatestPriceBaseDate } from "./market";
import { fetchStockHistory, isValidCode, normalizeCode, searchStocks } from "./stock";
import { seoulToday, shiftYears } from "./trading-date";

const MOBILE_SCHEMA_VERSION = "1.0" as const;
const RECENT_FILING_ROWS = 5;

export class MobileRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
    this.name = "MobileRequestError";
  }
}

export function normalizeMobileStockCode(rawCode: string): string {
  const code = normalizeCode(decodeURIComponent(rawCode).trim().toUpperCase());
  if (!isValidCode(code)) {
    throw new MobileRequestError("여섯 자리 종목코드로 다시 시도해 주세요.", 400, "INVALID_STOCK_CODE");
  }
  return code;
}

export async function mobileMarketResponse() {
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융위원회 주식시세정보·지수시세정보",
    market: await getMarketSnapshot(),
  };
}

export async function mobileSearchResponse(rawQuery: string) {
  const query = rawQuery.trim();
  if (query.length === 0) {
    throw new MobileRequestError("종목명 또는 종목코드를 입력해 주세요.", 400, "EMPTY_QUERY");
  }
  if (query.length > 50) {
    throw new MobileRequestError("검색어는 50자 이하로 입력해 주세요.", 400, "QUERY_TOO_LONG");
  }
  const result = await searchStocks(query);
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융위원회 KRX상장종목정보",
    query,
    ...result,
  };
}

export async function mobileStockResponse(rawCode: string) {
  const code = normalizeMobileStockCode(rawCode);
  const marketBaseDate = await resolveLatestPriceBaseDate();
  const { quote, bars } = await fetchStockHistory(code, marketBaseDate);
  if (!quote) {
    throw new MobileRequestError("이 종목의 최근 시세를 찾지 못했습니다.", 404, "STOCK_NOT_FOUND");
  }

  const corp = await findCorpByStockCode(code);
  let filings:
    | { state: "none"; totalCount: 0; recent: never[] }
    | { state: "ready"; corpName: string; from: string; to: string; totalCount: number; recent: Awaited<ReturnType<typeof fetchFilings>>["filings"] }
    | { state: "error"; totalCount: 0; recent: never[] } = { state: "none", totalCount: 0, recent: [] };

  if (corp && bars.length > 0) {
    try {
      const from = bars[0].date;
      const to = seoulToday();
      const page = await fetchFilings({
        corpCode: corp.corpCode,
        from,
        to,
        pageNo: 1,
        pageCount: RECENT_FILING_ROWS,
      });
      filings = {
        state: "ready",
        corpName: corp.corpName,
        from,
        to,
        totalCount: page.totalCount,
        recent: page.filings,
      };
    } catch {
      // 공시 장애가 가격 화면 전체를 막지 않게 상태만 전달한다.
      filings = { state: "error", totalCount: 0, recent: [] };
    }
  }

  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    sources: ["금융위원회 주식시세정보", "금융감독원 전자공시시스템(OpenDART)"],
    marketBaseDate,
    quote,
    bars,
    filings,
  };
}

export async function mobileFilingsResponse(rawCode: string, rawPage: string | null) {
  const code = normalizeMobileStockCode(rawCode);
  const parsedPage = Number(rawPage ?? "1");
  const pageNo = Number.isInteger(parsedPage) && parsedPage >= 1 ? parsedPage : 1;
  const corp = await findCorpByStockCode(code);
  if (!corp) {
    throw new MobileRequestError("이 종목에 연결된 공시 회사를 찾지 못했습니다.", 404, "DART_CORP_NOT_FOUND");
  }
  const to = seoulToday();
  const from = shiftYears(to, -1);
  const page = await fetchFilings({ corpCode: corp.corpCode, from, to, pageNo, pageCount: 20 });
  return {
    schemaVersion: MOBILE_SCHEMA_VERSION,
    source: "금융감독원 전자공시시스템(OpenDART) 공시검색",
    code,
    corpName: corp.corpName,
    from,
    to,
    ...page,
  };
}

export function mobileErrorResponse(caught: unknown): Response {
  if (caught instanceof MobileRequestError) {
    return Response.json({ error: caught.message, code: caught.code }, { status: caught.status });
  }
  console.error("mobile_api_error", {
    name: caught instanceof Error ? caught.name : typeof caught,
  });
  return Response.json(
    { error: "서버가 공식 자료를 확인하지 못했습니다. 잠시 뒤 다시 시도해 주세요.", code: "UPSTREAM_FAILURE" },
    { status: 502 }
  );
}
