import "server-only";

import { fetchFilings, findCorpByStockCode } from "./dart";
import { resolveLatestPriceBaseDate } from "./market";
import { fetchStockHistory, searchStocks } from "./stock";
import { seoulToday, shiftYears } from "./trading-date";
import { isChatStockCode } from "./chat-contract";
import type {
  ChatFilingsResult,
  ChatLookups,
  ChatPriceSourceResult,
  ChatSearchResult,
} from "./chat-answer";

/**
 * 챗봇이 쓰는 조회는 모두 이 Adapter를 지난다.
 * 기존 함수의 의미·반환값은 바꾸지 않고, 챗봇에 필요한 값만 꺼내 쓴다.
 */

/**
 * `searchStocks`가 내부에서 이미 최대 20건으로 자른다(`src/lib/stock.ts`의 `SEARCH_LIMIT`).
 * 그 값을 바꾸지 않고 여기서 같은 수를 알아 둔다. 20건이면 더 있을 수 있다는 뜻이다.
 */
const SEARCH_HITS_CAP = 20;

/** 후보로 보여 줄 최대 수. 자른 목록은 확정된 하나와 다르다. */
const CANDIDATE_LIMIT = 5;

export async function chatSearchStocks(query: string): Promise<ChatSearchResult> {
  const { baseDate, hits } = await searchStocks(query);
  const toTarget = (hit: (typeof hits)[number]) => ({
    code: hit.code,
    name: hit.name,
    market: hit.market,
    corpName: hit.corpName,
    baseDate: hit.baseDate,
  });
  /*
   * **후보 수를 자르기 전에** 종목코드 계약을 지원하지 않는 항목을 뺀다. 자른 뒤에 빼면
   * 다룰 수 없는 코드가 다룰 수 있는 후보의 자리를 차지해, 고를 수 있는 후보가 줄어든다.
   * (실제 `삼성` 검색 결과에 `0044K0`처럼 다섯째 자리가 글자인 코드가 있었다.)
   * 기존 `searchStocks`의 정렬·건수·반환 모양은 바꾸지 않는다. `totalFound`도 검색이 찾은
   * 전체 건수 그대로 두어, 뺀 만큼을 못 찾은 것처럼 적지 않는다.
   */
  const supported = hits.filter((hit) => isChatStockCode(hit.code));
  const unsupported = hits.filter((hit) => !isChatStockCode(hit.code));
  return {
    baseDate,
    totalFound: hits.length,
    // 자체 상한에 닿았으면 실제 건수는 더 많을 수 있다.
    capped: hits.length >= SEARCH_HITS_CAP,
    candidates: supported.slice(0, CANDIDATE_LIMIT).map(toTarget),
    // 화면에 내보내는 목록이 아니다. 하나로 확정해도 되는지 판정할 근거로만 넘긴다.
    unsupported: unsupported.slice(0, CANDIDATE_LIMIT).map(toTarget),
  };
}

/**
 * 확인된 한 종목의 최근 1년 공시를 최신순으로 최대 `limit`건 돌려준다.
 * 기간은 기존 화면·모바일 API와 같은 방식으로 서울 오늘에서 1년을 거슬러 잡는다.
 * 공시 본문은 읽지 않고, 원문 URL은 기존 `filingDocumentUrl`이 접수번호로 만든 값을 그대로 쓴다.
 */
export async function chatListFilings(input: {
  stockCode: string;
  limit: number;
}): Promise<ChatFilingsResult> {
  const corp = await findCorpByStockCode(input.stockCode);
  if (!corp) {
    return { ok: false, reason: "corp_unmapped" };
  }

  const to = seoulToday();
  const from = shiftYears(to, -1);
  const page = await fetchFilings({
    corpCode: corp.corpCode,
    from,
    to,
    pageNo: 1,
    pageCount: input.limit,
  });

  // OpenDART가 최신순으로 주지만, 화면에 쓰는 순서를 응답 순서에만 맡기지 않는다.
  const items = [...page.filings]
    .sort((a, b) => b.receiptDate.localeCompare(a.receiptDate) || b.receiptNo.localeCompare(a.receiptNo))
    .slice(0, input.limit)
    .map((filing) => ({
      receiptNo: filing.receiptNo,
      receiptDate: filing.receiptDate,
      reportName: filing.reportName,
      filerName: filing.filerName,
      documentUrl: filing.documentUrl,
    }));

  return {
    ok: true,
    from,
    to,
    totalCount: page.totalCount,
    items,
    // 대조용. 요청 코드가 아니라 공시 회사 정보에 적혀 있는 종목코드를 그대로 옮긴다.
    sourceStockCode: corp.stockCode ?? null,
  };
}

/**
 * 한 종목의 가격 원본을 모은다. 기간 계산은 하지 않는다.
 *
 * 기존 `resolveLatestPriceBaseDate`(최근 확인 가격 기준일)와 `fetchStockHistory`(최근 1년 일봉)를
 * 그대로 부르고 필요한 값만 꺼낸다. 기준일을 찾지 못하는 것은 **자료가 없는 것과 다르므로**
 * 예외로 흘리지 않고 사유를 구분해 돌려준다.
 *
 * 이 함수는 부를 때마다 조회한다. 같은 요청 안에서 1개월·3개월을 함께 물어도 한 번만 받도록,
 * 재사용은 부르는 쪽(`runChatTurn`)의 request-local 보관함이 담당한다.
 */
export async function chatPriceSource(stockCode: string): Promise<ChatPriceSourceResult> {
  let baseDate: string;
  try {
    baseDate = await resolveLatestPriceBaseDate();
  } catch {
    return { ok: false, reason: "base_date_unavailable" };
  }

  const { quote, bars } = await fetchStockHistory(stockCode, baseDate);
  return {
    ok: true,
    baseDate,
    bars,
    // 기준일 하루 시세. 자료가 없으면 `null`이며, 값을 만들어 채우지 않는다.
    // `code`는 원본이 돌려준 종목코드를 그대로 옮긴다(요청 코드를 찍어 넣지 않는다).
    quote: quote ? { date: quote.baseDate, close: quote.close, code: quote.code ?? null } : null,
  };
}

export const chatLookups: ChatLookups = {
  searchStocks: chatSearchStocks,
  listFilings: chatListFilings,
  priceSource: chatPriceSource,
};
