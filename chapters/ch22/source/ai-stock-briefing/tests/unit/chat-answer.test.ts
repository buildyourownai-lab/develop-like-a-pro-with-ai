import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_CODE_UNSUPPORTED_NOTE,
  CHAT_DATA_UNCONFIRMED,
  CHAT_EVIDENCE_TARGET_MISMATCH_NOTE,
  CHAT_EXPLANATION_REJECTED_NOTE,
  CHAT_LIMIT_REACHED_NOTE,
  CHAT_MODEL_UNAVAILABLE_NOTE,
  CHAT_PERIOD_CLARIFICATION,
  CHAT_PERIOD_UNCLEAR_NOTE,
  CHAT_PRICE_BASE_DATE_FAILED_NOTE,
  CHAT_QUERY_NOT_GROUNDED_NOTE,
  CHAT_RESPONSE_SCHEMA,
  CHAT_TARGET_UNKNOWN,
  CHAT_TIME_LIMIT_NOTE,
  ChatSelectionRejectedError,
  InvalidChatAnswerError,
  buildChatToolRequest,
  chatQuestionMentions,
  chatQuestionPeriods,
  groundChatSearchQuery,
  readChatModelTurn,
  runChatTurn,
  uniqueExactMatch,
  validateChatModelAnswer,
  type ChatFilingsResult,
  type ChatLookups,
  type ChatModelContent,
  type ChatModelPart,
  type ChatModelToolCall,
  type ChatModelTurn,
  type ChatPriceSourceResult,
  type ChatSearchResult,
  type SendChatTurn,
} from "../../src/lib/chat-answer";
import { ChatBudgetExceededError, ChatCallBudget } from "../../src/lib/chat-budget";
import {
  CHAT_GENERAL_DISCLAIMER,
  CHAT_GENERAL_HEADING,
  CHAT_VERIFIED_HEADING,
  type ChatAnswerPayload,
  type ChatAskRequest,
  type ChatPriceLatestEvidence,
  type ChatPriceRangeEvidence,
} from "../../src/lib/chat-contract";
import type { DailyBar } from "../../src/lib/types";

/* ------------------------------------------------------------------ *
 * 시험용 대역: 실제 기능 호출 응답 순서를 대신 만든다
 * ------------------------------------------------------------------ */

const SAMSUNG = {
  code: "005930",
  name: "삼성전자",
  market: "KOSPI",
  corpName: "삼성전자주식회사",
  baseDate: "20260911",
};
const SK = { code: "000660", name: "SK하이닉스", market: "KOSPI", corpName: "에스케이하이닉스", baseDate: "20260911" };
/** 같은 회사의 우선주. 이름이 다른 별개 종목이므로 보통주와 뭉개지 않는다. */
const SAMSUNG_PREFERRED = {
  code: "005935",
  name: "삼성전자우",
  market: "KOSPI",
  corpName: "삼성전자주식회사",
  baseDate: "20260911",
};
const SAMSUNG_FAMILY = [
  SAMSUNG,
  { code: "009150", name: "삼성전기", market: "KOSPI", corpName: "삼성전기주식회사", baseDate: "20260911" },
  { code: "006400", name: "삼성SDI", market: "KOSPI", corpName: "삼성에스디아이", baseDate: "20260911" },
];

const FILING = {
  receiptNo: "20260908000123",
  receiptDate: "20260908",
  reportName: "주요사항보고서(자기주식취득결정)",
  filerName: "삼성전자",
  documentUrl: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260908000123",
};

function one(hit: typeof SAMSUNG): ChatSearchResult {
  return { baseDate: hit.baseDate, totalFound: 1, capped: false, candidates: [hit] };
}

function many(hits: typeof SAMSUNG_FAMILY, capped = false): ChatSearchResult {
  return { baseDate: hits[0].baseDate, totalFound: capped ? 20 : hits.length, capped, candidates: hits };
}

type LookupLog = { searches: string[]; filings: { stockCode: string; limit: number }[]; prices: string[] };

function newLog(): LookupLog {
  return { searches: [], filings: [], prices: [] };
}

function fakeLookups(
  plan: {
    search?: (query: string) => ChatSearchResult;
    filings?: (input: { stockCode: string; limit: number }) => ChatFilingsResult;
    price?: (stockCode: string) => ChatPriceSourceResult;
  },
  log: LookupLog
): ChatLookups {
  return {
    async searchStocks(query) {
      log.searches.push(query);
      if (!plan.search) throw new Error("검색을 부르지 않아야 한다");
      return plan.search(query);
    },
    async listFilings(input) {
      log.filings.push(input);
      if (!plan.filings) throw new Error("공시 조회를 부르지 않아야 한다");
      return plan.filings(input);
    },
    async priceSource(stockCode) {
      log.prices.push(stockCode);
      if (!plan.price) throw new Error("가격 원본을 조회하지 않아야 한다");
      return plan.price(stockCode);
    },
  };
}

/**
 * 실제 SDK 응답 모양(`candidates[0].content.parts`)을 만들고, 제품 코드와 같은 reader로 읽는다.
 * 기능 호출 목록만 손으로 적으면 part에 붙는 값(`thoughtSignature` 등)이 보존되는지 확인할 수 없다.
 */
function modelTurn(parts: ChatModelPart[]): ChatModelTurn {
  const text = parts.map((part) => part.text ?? "").join("");
  return readChatModelTurn({
    candidates: [{ content: { role: "model", parts } }],
    ...(text.length > 0 ? { text } : {}),
  });
}

/** 모델이 차례대로 돌려줄 응답을 미리 정한다. 문자열을 읽어 기능 호출을 흉내내지 않는다. */
function scriptedModel(turns: ChatModelTurn[], sent: ChatModelContent[][]): SendChatTurn {
  let index = 0;
  return async (contents, options) => {
    assert.ok(options.timeoutMs > 0, "남은 시간을 넘겨받아야 한다");
    // part 객체는 그대로 둔 얕은 복사다. 서버가 무엇을 그대로 넘겼는지 볼 수 있어야 한다.
    sent.push(contents.map((content) => ({ role: content.role, parts: [...content.parts] })));
    const turn = turns[index];
    index += 1;
    if (!turn) throw new Error(`예정하지 않은 ${index}번째 모델 호출이다`);
    return { turn, model: "test-model" };
  };
}

function toolCall(name: string, args: Record<string, unknown>, id = `c-${name}`): ChatModelTurn {
  return modelTurn([{ functionCall: { id, name, args } }]);
}

function toolCalls(calls: ChatModelToolCall[]): ChatModelTurn {
  return modelTurn(calls.map((call) => ({ functionCall: call })));
}

function finalText(answer: Record<string, unknown>): ChatModelTurn {
  return modelTurn([{ text: JSON.stringify(answer) }]);
}

/**
 * 시험용 일봉. 주말만 빼고 평일마다 한 건을 만든다(공휴일은 개별 시험에서 구간을 잘라 다룬다).
 * 종가는 하루 10원씩 오르게 두어 계산 결과를 손으로 확인할 수 있게 한다.
 */
function weekdayBars(from: string, to: string): DailyBar[] {
  const dayMs = 86_400_000;
  const parse = (value: string) =>
    Date.UTC(Number(value.slice(0, 4)), Number(value.slice(4, 6)) - 1, Number(value.slice(6, 8)));
  const bars: DailyBar[] = [];
  let index = 0;
  for (let time = parse(from); time <= parse(to); time += dayMs) {
    const day = new Date(time);
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    const close = 50_000 + index * 10;
    bars.push({
      date: day.toISOString().slice(0, 10).replaceAll("-", ""),
      open: close,
      high: close + 100,
      low: close - 100,
      close,
      volume: 1_000 + index,
      tradeValue: close * 1_000,
    });
    index += 1;
  }
  return bars;
}

/**
 * 기준일까지의 일봉과 그 기준일 하루 시세를 함께 만든다.
 * `quoteCode`는 원본이 돌려준 종목코드다. 알려 주지 않는 원본을 흉내내려면 `null`로 둔다.
 */
function priceSourceOf(
  baseDate: string,
  from: string,
  barsTo = baseDate,
  quoteCode: string | null = null
): ChatPriceSourceResult {
  const bars = weekdayBars(from, barsTo);
  const last = bars[bars.length - 1];
  return {
    ok: true,
    baseDate,
    bars,
    quote: last && last.date === baseDate ? { date: last.date, close: last.close, code: quoteCode } : null,
  };
}

const GENERAL_TEXT = finalText({
  kind: "general",
  summary: "공시는 회사가 알려야 할 사실을 공개하는 절차입니다.",
  points: ["접수일은 공시를 낸 날이며, 내용이 일어난 날과 다를 수 있습니다."],
});

const DATA_ONLY_TEXT = finalText({ kind: "data_only", summary: "", points: [] });

function ask(question: string, extra: Partial<ChatAskRequest> = {}): ChatAskRequest {
  return { question, history: [], routeCode: null, targetCode: null, selection: null, ...extra };
}

/**
 * 가격 근거는 두 모양(최근 확인 종가 / 기간 요약) 중 하나다. 시험에서도 섞어 읽지 않는다.
 * 기대한 모양이 아니면 그 자리에서 실패한다.
 */
function rangePrice(payload: ChatAnswerPayload): ChatPriceRangeEvidence {
  const price = payload.verified?.price ?? null;
  assert.equal(price?.kind, "range", "기간 요약 근거여야 한다");
  return price as ChatPriceRangeEvidence;
}

function latestPrice(payload: ChatAnswerPayload): ChatPriceLatestEvidence {
  const price = payload.verified?.price ?? null;
  assert.equal(price?.kind, "latest", "최근 확인 종가 근거여야 한다");
  return price as ChatPriceLatestEvidence;
}

/** functionResponse로 모델에 실제로 넘어간 값 */
function responsesSentTo(sent: ChatModelContent[][]): Record<string, unknown>[] {
  return sent
    .flat()
    .flatMap((content) => content.parts)
    .flatMap((part) => (part.functionResponse ? [part.functionResponse.response ?? {}] : []));
}

/* ------------------------------------------------------------------ *
 * 조회 횟수
 * ------------------------------------------------------------------ */

test("일반 개념 질문은 기능을 부르지 않고 조회 0회로 끝난다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(ask("변동성이 뭐야?"), {
    sendTurn: scriptedModel(
      [
        finalText({
          kind: "general",
          summary: "변동성은 값이 흔들린 정도를 나타내는 개념입니다.",
          points: ["같은 기간이라도 값이 크게 오르내리면 변동성이 크다고 말합니다."],
        }),
      ],
      []
    ),
    lookups: fakeLookups({}, log),
    budget,
    requestId: "req-general",
  });

  assert.deepEqual(log, newLog());
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 0 });
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(payload.verified, null, "일반 질문에는 빈 자료 카드를 만들지 않는다");
  assert.deepEqual(payload.steps, []);
  assert.equal(payload.general?.heading, CHAT_GENERAL_HEADING);
  assert.equal(payload.general?.disclaimer, CHAT_GENERAL_DISCLAIMER);
});

test("공시 질문은 종목 찾기와 공시 조회만 하고 가격 조회는 0회다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(
    ask("삼성전자의 최근 공시 5건을 DART 원문과 함께 보여줘."),
    {
      sendTurn: scriptedModel(
        [
          toolCall("find_stock", { query: "삼성전자" }),
          toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
          DATA_ONLY_TEXT,
        ],
        sent
      ),
      lookups: fakeLookups(
        {
          search: () => one(SAMSUNG),
          filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 42, items: [FILING], sourceStockCode: input.stockCode }),
        },
        log
      ),
      budget,
      requestId: "req-filings",
    }
  );

  assert.deepEqual(log.searches, ["삼성전자"]);
  assert.deepEqual(log.filings, [{ stockCode: "005930", limit: 5 }]);
  assert.deepEqual(budget.usage(), { modelCalls: 3, lookups: 2 });
  assert.equal(usage.executedToolCalls, 2);
  assert.equal(payload.verified?.heading, CHAT_VERIFIED_HEADING);
  assert.equal(payload.verified?.target?.name, "삼성전자");
  assert.equal(payload.verified?.filings?.totalCount, 42);
  assert.equal(payload.verified?.filings?.shownCount, 1);
  assert.equal(payload.verified?.filings?.requestedCount, 5);
  // 링크·날짜는 서버가 만든 값 그대로다.
  assert.equal(payload.verified?.filings?.items[0].documentUrl, FILING.documentUrl);
  assert.equal(payload.general, null, "확인된 자료만으로 답하는 질문에는 일반 설명을 만들지 않는다");
  assert.deepEqual(payload.steps, ["종목 찾기", "공시 조회"]);

  // 모델에는 제목·링크를 넘기지 않는다. 화면 값은 서버가 직접 그린다.
  const serialized = JSON.stringify(responsesSentTo(sent));
  assert.equal(serialized.includes(FILING.documentUrl), false);
  assert.equal(serialized.includes(FILING.reportName), false);
});

test("공시와 개념을 함께 물으면 확인된 자료와 일반 설명이 모두 만들어진다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("삼성전자 최근 공시를 보여주고, 접수일이 무슨 뜻인지도 설명해줘."),
    {
      sendTurn: scriptedModel(
        [
          toolCall("find_stock", { query: "삼성전자" }),
          toolCall("list_disclosures", { stockCode: "005930", limit: 3 }),
          GENERAL_TEXT,
        ],
        []
      ),
      lookups: fakeLookups(
        {
          search: () => one(SAMSUNG),
          filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 7, items: [FILING], sourceStockCode: input.stockCode }),
        },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-mixed",
    }
  );

  assert.ok(payload.verified?.filings);
  assert.equal(payload.general?.points.length, 1);
  assert.equal(payload.general?.disclaimer, CHAT_GENERAL_DISCLAIMER);
});

/* ------------------------------------------------------------------ *
 * 후보 선택과 재개
 * ------------------------------------------------------------------ */

test("후보가 여럿이면 하위 조회와 다음 모델 호출 없이 멈춘다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload } = await runChatTurn(ask("삼성 공시 보여줘."), {
    // 두 번째 모델 호출이 예정되지 않았다. 불리면 시험이 실패한다.
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성" })], []),
    lookups: fakeLookups({ search: () => many(SAMSUNG_FAMILY) }, log),
    budget,
    requestId: "req-ambiguous",
  });

  assert.deepEqual(log.filings, [], "후보 대기 중에는 공시 조회를 하지 않는다");
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 1 });
  assert.equal(payload.verified, null);
  assert.equal(payload.target, null, "고르기 전에는 대화 대상을 정하지 않는다");
  assert.equal(payload.selection?.searchQuery, "삼성");
  assert.equal(payload.selection?.candidates.length, 3);
  assert.equal(payload.selection?.totalFound, 3);
});

test("자른 후보 목록의 첫 항목을 확정으로 보지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성 공시 보여줘."), {
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성" })], []),
    lookups: fakeLookups({ search: () => many(SAMSUNG_FAMILY, true) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-capped",
  });

  assert.equal(payload.selection?.truncated, true);
  assert.equal(payload.selection?.totalFound, 20);
  assert.equal(payload.target, null);
});

test("후보를 고르면 원래 질문을 그대로 이어 처리한다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("삼성 공시 보여줘.", { selection: { searchQuery: "삼성", code: "005930" } }),
    {
      sendTurn: scriptedModel([toolCall("list_disclosures", { stockCode: "005930", limit: 5 }), DATA_ONLY_TEXT], []),
      lookups: fakeLookups(
        {
          // 브라우저가 보낸 코드를 사실로 받지 않고 같은 검색어로 다시 검색해 대조한다.
          search: () => many(SAMSUNG_FAMILY),
          filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 3, items: [FILING], sourceStockCode: input.stockCode }),
        },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-resume",
    }
  );

  assert.deepEqual(log.searches, ["삼성"]);
  assert.deepEqual(log.filings, [{ stockCode: "005930", limit: 5 }]);
  assert.equal(payload.target?.code, "005930");
  assert.equal(payload.verified?.filings?.totalCount, 3);
});

test("검색 결과에 없는 선택값은 거절하고 하위 조회를 하지 않는다", async () => {
  const log = newLog();
  await assert.rejects(
    runChatTurn(ask("삼성 공시 보여줘.", { selection: { searchQuery: "삼성", code: "999999" } }), {
      sendTurn: scriptedModel([], []),
      lookups: fakeLookups({ search: () => many(SAMSUNG_FAMILY) }, log),
      budget: new ChatCallBudget(),
      requestId: "req-tampered",
    }),
    ChatSelectionRejectedError
  );
  assert.deepEqual(log.filings, []);
});

/* ------------------------------------------------------------------ *
 * 대화 대상
 * ------------------------------------------------------------------ */

test("화면 종목코드도 실제 검색으로 확인한 뒤에만 조회에 쓴다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("이 종목 공시 보여줘.", { routeCode: "000660" }), {
    sendTurn: scriptedModel([toolCall("list_disclosures", { stockCode: "000660", limit: 5 }), DATA_ONLY_TEXT], []),
    lookups: fakeLookups(
      {
        search: () => one(SK),
        filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 11, items: [], sourceStockCode: input.stockCode }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-route",
  });

  assert.deepEqual(log.searches, ["000660"], "코드도 상장종목에서 대조한다");
  assert.equal(payload.target?.name, "SK하이닉스");
  assert.deepEqual(payload.steps, ["종목 찾기", "공시 조회"]);
});

test("확인하지 않은 종목코드로 부른 공시 조회는 실행하지 않는다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const { payload, usage } = await runChatTurn(ask("공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("list_disclosures", { stockCode: "999999", limit: 5 }),
        finalText({ kind: "stock_data_request", summary: "어느 종목인지 알 수 없습니다.", points: [] }),
      ],
      sent
    ),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-unconfirmed",
  });

  assert.deepEqual(log, newLog());
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 1);
  assert.equal(payload.status?.message, CHAT_TARGET_UNKNOWN.message);
  assert.ok(payload.status!.nextActions.length <= 2);
  assert.ok(String(responsesSentTo(sent)[0].error).length > 0);
});

test("대화 대상을 바꾸면 새 종목이 대상이 된다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("SK하이닉스 공시는 어때?", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          toolCall("find_stock", { query: "SK하이닉스" }),
          toolCall("list_disclosures", { stockCode: "000660", limit: 5 }),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups(
        {
          search: () => one(SK),
          filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 5, items: [FILING], sourceStockCode: input.stockCode }),
        },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-switch",
    }
  );

  assert.deepEqual(log.searches, ["SK하이닉스"]);
  assert.equal(payload.target?.code, "000660", "바뀐 대상이 응답에 담긴다");
});

test("이전 대화의 회사명·수치는 사실 근거로 쓰지 않고 언어 문맥으로만 넘긴다", async () => {
  const sent: ChatModelContent[][] = [];
  const log = newLog();
  await runChatTurn(
    ask("접수일이 무슨 뜻이야?", {
      history: [
        { role: "user", text: "삼성전자 공시 보여줘." },
        { role: "model", text: "공시 목록을 표시했습니다." },
      ],
    }),
    {
      sendTurn: scriptedModel([GENERAL_TEXT], sent),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-history",
    }
  );

  const roles = sent[0].map((content) => content.role);
  assert.deepEqual(roles, ["user", "model", "user"], "history는 사용자·모델 역할로만 들어간다");
  assert.deepEqual(log, newLog());
});

/* ------------------------------------------------------------------ *
 * 중복 제거·상한·거절
 * ------------------------------------------------------------------ */

test("같은 요청 안의 같은 기능·같은 입력은 다시 실행하지 않는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { usage } = await runChatTurn(ask("삼성전자 알려줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }, "c-1"),
        toolCall("find_stock", { query: "삼성전자" }, "c-2"),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget,
    requestId: "req-dedupe",
  });

  assert.deepEqual(log.searches, ["삼성전자"], "검색은 한 번만 실행한다");
  assert.equal(usage.requestedToolCalls, 2);
  assert.equal(usage.executedToolCalls, 1);
  assert.equal(usage.reusedToolCalls, 1);
  assert.deepEqual(budget.usage(), { modelCalls: 3, lookups: 1 });
});

test("한 응답의 도구 제안 수 상한을 넘는 제안은 실행하지 않는다", async () => {
  const log = newLog();
  const { usage } = await runChatTurn(ask("삼성전자 알려줘."), {
    sendTurn: scriptedModel(
      [
        // 검색어는 질문에 적힌 말 그대로여야 하므로(서버 규칙) 여섯 제안 모두 같은 회사명이다.
        toolCalls(
          Array.from({ length: 6 }, (_, index) => ({
            id: `c-${index}`,
            name: "find_stock",
            args: { query: "삼성전자" },
          }))
        ),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget: new ChatCallBudget({ lookups: 9 }),
    requestId: "req-too-many",
  });

  assert.equal(usage.requestedToolCalls, 6);
  assert.equal(usage.rejectedToolCalls, 2, "상한을 넘는 2건은 실행하지 않는다");
});

test("허용 목록에 없는 기능과 잘못된 입력은 실행하지 않고 모델에 거절을 알린다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const { usage, payload } = await runChatTurn(ask("공시 원문 좀 읽어줘."), {
    sendTurn: scriptedModel(
      [
        toolCalls([
          { id: "c-1", name: "read_filing_document", args: { url: "https://dart.fss.or.kr/x" } },
          { id: "c-2", name: "find_stock", args: { query: "삼성전자'; DROP TABLE" } },
        ]),
        GENERAL_TEXT,
      ],
      sent
    ),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-rejected",
  });

  assert.deepEqual(log, newLog());
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 2);
  assert.equal(payload.verified, null);
  assert.equal(responsesSentTo(sent).length, 2);
});

/* ------------------------------------------------------------------ *
 * 가격 요약 (달력 1·3·12개월)
 * ------------------------------------------------------------------ */

/**
 * 기준일·기간·원본 구간을 주고 가격 요약 한 번을 돌린다.
 *
 * 질문에는 **그 기간을 사용자가 실제로 적은 것으로** 둔다. 서버가 질문에 없는 기간을 받지
 * 않기 때문이다(질문에 기간이 없을 때 되묻는 동작은 아래 별도 Test에서 확인한다).
 */
const PERIOD_IN_QUESTION: Record<string, string> = { "1m": "1개월", "3m": "3개월", "12m": "12개월" };

async function askPrice(options: {
  period: string;
  source: ChatPriceSourceResult;
  requestId: string;
  final?: ChatModelTurn;
}) {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const budget = new ChatCallBudget();
  const asked = PERIOD_IN_QUESTION[options.period] ?? "";
  const { payload, usage } = await runChatTurn(
    ask(`이 종목 ${asked} 가격 흐름 알려줘.`, { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          toolCall("get_price_summary", { stockCode: "005930", period: options.period }),
          options.final ?? DATA_ONLY_TEXT,
        ],
        sent
      ),
      lookups: fakeLookups({ search: () => one(SAMSUNG), price: () => options.source }, log),
      budget,
      requestId: options.requestId,
    }
  );
  return { payload, usage, log, sent, budget };
}

test("달력 1·3·12개월 요청 구간을 기준일에서 거슬러 센다", async () => {
  const source = priceSourceOf("20260914", "20250915");

  const oneMonth = await askPrice({ period: "1m", source, requestId: "req-price-1m" });
  const price = rangePrice(oneMonth.payload);
  assert.equal(price?.periodLabel, "1개월");
  assert.equal(price?.baseDate, "20260914");
  assert.deepEqual([price?.requestedFrom, price?.requestedTo], ["20260814", "20260914"]);
  // 요청 구간과 실제 확인된 거래일 구간은 다르다. 8월 14일은 금요일이라 그날부터 자료가 있다.
  assert.deepEqual([price?.actualFrom, price?.actualTo], ["20260814", "20260914"]);
  assert.equal(price?.limitedBySource, false);
  assert.equal(price?.tradingDays, 22, "달력 1개월은 22거래일과 같은 뜻이 아니라 결과로 나온 수다");
  assert.equal(price?.baseDateClose, price?.endClose);
  assert.deepEqual(oneMonth.log.prices, ["005930"]);
  assert.deepEqual(oneMonth.payload.steps, ["종목 찾기", "가격 요약"]);

  const threeMonths = await askPrice({ period: "3m", source, requestId: "req-price-3m" });
  assert.equal(rangePrice(threeMonths.payload).requestedFrom, "20260614");
  assert.equal(rangePrice(threeMonths.payload).periodLabel, "3개월");

  const year = await askPrice({ period: "12m", source, requestId: "req-price-12m" });
  const yearPrice = rangePrice(year.payload);
  assert.equal(yearPrice?.requestedFrom, "20250914");
  // 원본이 9월 15일부터 시작해 요청 구간 앞부분이 비어 있다. 12개월 전체 성과로 읽히지 않게 표시한다.
  assert.equal(yearPrice?.limitedBySource, true);
  assert.equal(yearPrice?.sourceFrom, "20250915");
});

test("대응 날짜가 없는 월말과 윤년은 그 달 말일로 맞춘다", async () => {
  const marchEnd = await askPrice({
    period: "1m",
    source: priceSourceOf("20260331", "20250401"),
    requestId: "req-price-month-end",
  });
  assert.equal(rangePrice(marchEnd.payload).requestedFrom, "20260228");

  const leap = await askPrice({
    period: "1m",
    source: priceSourceOf("20240331", "20230401"),
    requestId: "req-price-leap",
  });
  assert.equal(rangePrice(leap.payload).requestedFrom, "20240229");

  const leapYear = await askPrice({
    period: "12m",
    source: priceSourceOf("20240229", "20230101"),
    requestId: "req-price-leap-year",
  });
  assert.equal(rangePrice(leapYear.payload).requestedFrom, "20230228");
});

test("연도가 바뀌는 구간도 달력으로 센다", async () => {
  const january = await askPrice({
    period: "1m",
    source: priceSourceOf("20260105", "20250106"),
    requestId: "req-price-year-boundary",
  });
  assert.deepEqual(
    [rangePrice(january.payload).requestedFrom, rangePrice(january.payload).requestedTo],
    ["20251205", "20260105"]
  );

  const year = await askPrice({
    period: "12m",
    source: priceSourceOf("20260105", "20250106"),
    requestId: "req-price-year-boundary-12m",
  });
  assert.equal(rangePrice(year.payload).requestedFrom, "20250105");
});

test("기준일에 거래일 자료가 없으면 마지막 거래일이 요청 종료일보다 앞선다고 밝힌다", async () => {
  // 기준일은 9월 14일인데 원본은 9월 11일까지만 있다(휴장·자료 지연).
  const holiday = await askPrice({
    period: "1m",
    source: priceSourceOf("20260914", "20250915", "20260911"),
    requestId: "req-price-holiday",
  });
  const price = rangePrice(holiday.payload);
  assert.equal(price?.requestedTo, "20260914");
  assert.equal(price?.actualTo, "20260911");
  assert.equal(price?.endsBeforeRequestedTo, true);
  assert.equal(price?.baseDateClose, null, "기준일 하루 시세가 없으면 값을 만들지 않는다");
});

test("요청 구간에 확인된 거래일이 없으면 가격 카드를 만들지 않고 확인된 구간을 알린다", async () => {
  const short = await askPrice({
    period: "1m",
    source: priceSourceOf("20260914", "20260401", "20260601"),
    requestId: "req-price-empty-range",
  });
  assert.equal(short.payload.verified?.price, null);
  assert.equal(short.usage.unavailableToolCalls, 1);
  assert.ok(
    short.payload.verified?.notes.some((note) => note.includes("20260401~20260601")),
    "확인된 자료 구간을 그대로 알린다"
  );
  assert.deepEqual(short.payload.steps, ["종목 찾기"], "값을 만들지 못한 일은 수행 내역에 넣지 않는다");
});

test("가격 기준일을 찾지 못하면 자료 없음으로 바꾸지 않는다", async () => {
  const failed = await askPrice({
    period: "1m",
    source: { ok: false, reason: "base_date_unavailable" },
    requestId: "req-price-no-base-date",
  });
  assert.equal(failed.payload.verified?.price, null);
  assert.ok(failed.payload.verified?.notes.includes(CHAT_PRICE_BASE_DATE_FAILED_NOTE));
});

test("기간이 분명하지 않으면 추측하지 않고 되묻는다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 가격 흐름 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          // 6개월은 지원하지 않는다. 1·3·12개월 중 하나로 임의로 바꾸지 않는다.
          toolCall("get_price_summary", { stockCode: "005930", period: "6m" }),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-price-unclear",
    }
  );

  assert.deepEqual(log, newLog(), "기간을 모르면 조회를 시작하지 않는다");
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 1);
  assert.equal(payload.status?.message, CHAT_PERIOD_UNCLEAR_NOTE);
});

test("같은 요청에서 기간이 둘이면 최근 1년 일봉을 한 번만 받는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 1개월과 3개월 흐름을 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          toolCalls([
            { id: "p-1", name: "get_price_summary", args: { stockCode: "005930", period: "1m" } },
            { id: "p-2", name: "get_price_summary", args: { stockCode: "005930", period: "3m" } },
          ]),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups(
        { search: () => one(SAMSUNG), price: () => priceSourceOf("20260914", "20250915") },
        log
      ),
      budget,
      requestId: "req-price-reuse",
    }
  );

  assert.deepEqual(log.prices, ["005930"], "일봉 원본은 한 번만 받는다");
  assert.equal(usage.executedToolCalls, 2, "기간이 다르면 요약은 두 번 만든다");
  // 예약한 조회는 검색 1 + 가격 원본 1이다. 재사용에는 조회를 예약하지 않는다.
  assert.deepEqual(budget.usage(), { modelCalls: 2, lookups: 2 });
  // 화면에는 마지막으로 확정한 기간이 남는다(두 기간을 한 카드에 섞지 않는다).
  assert.equal(rangePrice(payload).periodLabel, "3개월");
});

test("가격과 공시를 함께 물어도 한 요청의 상한 안에서 끝난다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload } = await runChatTurn(
    ask("삼성전자 최근 3개월 흐름과 최근 공시를 함께 보여주고, 기준일을 확인해야 하는 이유도 알려줘."),
    {
      sendTurn: scriptedModel(
        [
          toolCall("find_stock", { query: "삼성전자" }),
          toolCalls([
            { id: "p-1", name: "get_price_summary", args: { stockCode: "005930", period: "3m" } },
            { id: "f-1", name: "list_disclosures", args: { stockCode: "005930", limit: 2 } },
          ]),
          finalText({
            kind: "general",
            summary: "가격 자료는 언제 기준의 값인지에 따라 뜻이 달라집니다.",
            points: ["기준일이 다르면 같은 종목의 값도 서로 비교하기 어렵습니다."],
          }),
        ],
        []
      ),
      lookups: fakeLookups(
        {
          search: () => one(SAMSUNG),
          price: () => priceSourceOf("20260914", "20250915"),
          filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 9, items: [FILING], sourceStockCode: input.stockCode }),
        },
        log
      ),
      budget,
      requestId: "req-price-and-filings",
    }
  );

  // 모델 3회·조회 4회·30초 안이다. 상한을 늘리지 않았다.
  assert.deepEqual(budget.usage(), { modelCalls: 3, lookups: 3 });
  assert.equal(rangePrice(payload).periodLabel, "3개월");
  assert.equal(payload.verified?.filings?.totalCount, 9);
  assert.deepEqual(payload.steps, ["종목 찾기", "가격 요약", "공시 조회"]);
  assert.equal(payload.general?.points.length, 1);
});

test("조회 상한에 닿으면 확보한 가격만 표시하고 상한을 늘리지 않는다", async () => {
  const log = newLog();
  // 조회 2회만 허용한다: 종목 찾기 1 + 가격 원본 1. 공시 조회는 예약에 실패한다.
  const budget = new ChatCallBudget({ lookups: 2 });
  const { payload } = await runChatTurn(ask("삼성전자 1개월 흐름과 공시를 함께 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }),
        toolCalls([
          { id: "p-1", name: "get_price_summary", args: { stockCode: "005930", period: "1m" } },
          { id: "f-1", name: "list_disclosures", args: { stockCode: "005930", limit: 5 } },
        ]),
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: () => one(SAMSUNG),
        price: () => priceSourceOf("20260914", "20250915"),
        filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 9, items: [FILING], sourceStockCode: input.stockCode }),
      },
      log
    ),
    budget,
    requestId: "req-price-partial",
  });

  assert.deepEqual(log.filings, [], "예약에 실패하면 외부 호출을 시작하지 않는다");
  assert.ok(payload.verified?.price, "확보한 가격은 그대로 보여 준다");
  assert.equal(payload.verified?.filings, null, "확보하지 못한 공시를 만들어 채우지 않는다");
  assert.ok(payload.verified?.notes.includes(CHAT_LIMIT_REACHED_NOTE));
});

test("가격 수치와 날짜는 모델에 넘기지 않고 서버가 화면에 그린다", async () => {
  const source = priceSourceOf("20260914", "20250915");
  const { payload, sent } = await askPrice({ period: "1m", source, requestId: "req-price-no-numbers" });
  const price = rangePrice(payload);
  assert.ok(price);

  const serialized = JSON.stringify(responsesSentTo(sent));
  assert.equal(serialized.includes(String(price.endClose)), false);
  assert.equal(serialized.includes(price.actualFrom), false);
  assert.equal(serialized.includes(price.baseDate), false);
});

test("모델 호출 상한에 닿으면 확보한 자료까지만 표시하고 상한을 늘리지 않는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget({ modelCalls: 2 });
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여줘."), {
    sendTurn: scriptedModel(
      [toolCall("find_stock", { query: "삼성전자" }), toolCall("list_disclosures", { stockCode: "005930", limit: 5 })],
      []
    ),
    lookups: fakeLookups(
      {
        search: () => one(SAMSUNG),
        filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 2, items: [FILING], sourceStockCode: input.stockCode }),
      },
      log
    ),
    budget,
    requestId: "req-limit",
  });

  assert.deepEqual(budget.usage(), { modelCalls: 2, lookups: 2 });
  assert.ok(payload.verified?.notes.includes(CHAT_LIMIT_REACHED_NOTE));
  assert.equal(payload.verified?.filings?.totalCount, 2);
  assert.equal(payload.general, null);
});

test("확보한 자료가 없는 상태에서 상한에 닿으면 원인을 알리며 멈춘다", async () => {
  const log = newLog();
  await assert.rejects(
    runChatTurn(ask("변동성이 뭐야?"), {
      sendTurn: scriptedModel([], []),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget({ modelCalls: 0 }),
      requestId: "req-limit-empty",
    }),
    ChatBudgetExceededError
  );
});

test("설명 검증이 실패해도 확보한 자료는 그대로 표시한다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여주고 지금 사야 할지 알려줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        finalText({ kind: "general", summary: "지금은 매수 시점입니다.", points: ["목표 주가는 9만원입니다."] }),
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: () => one(SAMSUNG),
        filings: (input) => ({ ok: true, from: "20250914", to: "20260914", totalCount: 1, items: [FILING], sourceStockCode: input.stockCode }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-rejected-answer",
  });

  assert.equal(payload.general, null);
  assert.ok(payload.verified?.notes.includes(CHAT_EXPLANATION_REJECTED_NOTE));
  assert.equal(payload.verified?.filings?.items.length, 1);
});

test("조회가 실패하면 자료 없음으로 바꾸지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: () => one(SAMSUNG),
        filings: () => {
          throw new Error("OpenDART 요청이 실패했습니다. (HTTP 500)");
        },
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-lookup-failed",
  });

  assert.equal(payload.verified?.filings, null);
  assert.ok(payload.verified?.notes.some((note) => note.includes("자료가 없는 것과는 다릅니다")));
  assert.deepEqual(payload.steps, ["종목 찾기"], "실패한 조회는 수행 내역에 넣지 않는다");
});

/* ------------------------------------------------------------------ *
 * 모델 응답 재검사와 요청 payload
 * ------------------------------------------------------------------ */

test("투자 판단·예측·확인하지 않은 기업 현재 사실·HTML을 담은 응답을 거부한다", () => {
  const base = { kind: "general", summary: "변동성은 값이 흔들린 정도입니다.", points: ["설명 문장입니다."] };
  const reject = (patch: Record<string, unknown>) =>
    assert.throws(() => validateChatModelAnswer({ ...base, ...patch }), InvalidChatAnswerError);

  reject({ points: ["지금은 매수 시점으로 보입니다."] });
  reject({ points: ["목표 주가를 8만원으로 볼 수 있습니다."] });
  reject({ points: ["이 회사는 현재 저평가 상태입니다."] });
  reject({ points: ["이 회사의 최근 실적은 좋아졌습니다."] });
  reject({ points: ["주가가 오른 이유는 신제품 발표입니다."] });
  reject({ points: ["<b>변동성</b>은 값이 흔들린 정도입니다."] });
  reject({ points: ["자세한 내용은 https://example.test 를 보세요."] });
  reject({ kind: "general", summary: "요약", points: [] });
  reject({ kind: "tool_call" });
});

test("이해를 돕는 예시 숫자가 있는 일반 설명은 통과한다", () => {
  const answer = validateChatModelAnswer({
    kind: "general",
    summary: "등락률은 기준 값과 비교한 변화 비율입니다.",
    points: ["예를 들어 값이 1,000에서 1,100으로 바뀌면 10% 변화입니다."],
  });
  assert.equal(answer.points.length, 1);
});

test("모델 요청에는 허용한 세 기능만 들어가고 재시도·출력 상한이 붙는다", () => {
  const request = buildChatToolRequest([{ role: "user", parts: [{ text: "변동성이 뭐야?" }] }], {
    timeoutMs: 12_345,
  });
  const config = request.config as Record<string, unknown>;
  const tools = config.tools as { functionDeclarations: { name: string }[] }[];
  assert.deepEqual(
    tools[0].functionDeclarations.map((declaration) => declaration.name),
    ["find_stock", "list_disclosures", "get_price_summary"]
  );
  assert.equal("responseJsonSchema" in config, false, "도구와 응답 형식 강제를 함께 쓰지 않는다");
  assert.ok(typeof config.maxOutputTokens === "number" && config.maxOutputTokens > 0);
  assert.deepEqual(config.httpOptions, { timeout: 12_345, retryOptions: { attempts: 1 } });
});

test("코드 블록으로 감싼 최종 응답도 읽고, 길이 상한을 넘으면 거부한다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("변동성이 뭐야?"), {
    sendTurn: scriptedModel(
      [
        modelTurn([
          {
            text:
              "```json\n" +
              JSON.stringify({
                kind: "general",
                summary: "변동성은 값이 흔들린 정도입니다.",
                points: ["기간이 같아도 오르내림이 크면 변동성이 크다고 말합니다."],
              }) +
              "\n```",
          },
        ]),
      ],
      []
    ),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-fenced",
  });
  assert.equal(payload.general?.points.length, 1);

  await assert.rejects(
    runChatTurn(ask("변동성이 뭐야?"), {
      sendTurn: scriptedModel([modelTurn([{ text: "가".repeat(4_001) }])], []),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-too-long",
    }),
    InvalidChatAnswerError
  );
});

/* ------------------------------------------------------------------ *
 * SDK 경계: 모델이 준 part를 그대로 다시 보낸다
 * ------------------------------------------------------------------ */

test("모델이 준 part의 불투명 서명은 다음 요청에 그대로 실려 나간다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  // 실제 SDK가 주는 모양이다: 생각 part·기능 호출 part·문장 part에 각각 서명이 붙을 수 있다.
  const firstTurnParts: ChatModelPart[] = [
    { text: "어느 종목인지 확인해야 한다.", thought: true, thoughtSignature: "sig-thought" },
    {
      functionCall: { id: "c-1", name: "find_stock", args: { query: "삼성전자" } },
      thoughtSignature: "sig-call",
    },
  ];
  await runChatTurn(ask("삼성전자 공시 알려줘."), {
    sendTurn: scriptedModel(
      [
        readChatModelTurn({ candidates: [{ content: { role: "model", parts: firstTurnParts } }] }),
        DATA_ONLY_TEXT,
      ],
      sent
    ),
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-signature",
  });

  assert.equal(sent.length, 2, "두 번째 요청이 있어야 보존 여부를 확인할 수 있다");
  const secondRequest = sent[1];
  const modelContent = secondRequest.find((content) => content.role === "model");
  assert.ok(modelContent, "모델 turn을 다음 요청에 다시 넣는다");
  // 값·순서·개수가 모두 그대로여야 한다. parts를 다시 만들면 서명이 사라진다.
  assert.deepEqual(
    modelContent.parts.map((part) => part.thoughtSignature),
    ["sig-thought", "sig-call"]
  );
  assert.deepEqual(modelContent.parts, firstTurnParts);
  assert.equal(modelContent.parts[1], firstTurnParts[1], "같은 part 객체를 그대로 넘긴다");

  // 기능 응답은 그 뒤 turn에 짝으로 붙는다.
  const responses = secondRequest[secondRequest.length - 1];
  assert.equal(responses.parts.length, 1);
  assert.equal(responses.parts[0].functionResponse?.id, "c-1");
});

test("불투명 서명은 브라우저로 내보내지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자 공시 알려줘."), {
    sendTurn: scriptedModel(
      [
        readChatModelTurn({
          candidates: [
            {
              content: {
                role: "model",
                parts: [
                  {
                    functionCall: { id: "c-1", name: "find_stock", args: { query: "삼성전자" } },
                    thoughtSignature: "sig-secret",
                  },
                ],
              },
            },
          ],
        }),
        GENERAL_TEXT,
      ],
      []
    ),
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-signature-out",
  });

  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("sig-secret"), false);
  assert.equal(serialized.includes("thoughtSignature"), false);
});

test("실행하지 않은 기능 호출에도 짝이 되는 기능 응답을 붙인다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  await runChatTurn(ask("삼성전자 알려줘."), {
    sendTurn: scriptedModel(
      [
        toolCalls(
          Array.from({ length: 6 }, (_, index) => ({
            id: `c-${index}`,
            name: "find_stock",
            args: { query: `삼성${index}` },
          }))
        ),
        DATA_ONLY_TEXT,
      ],
      sent
    ),
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget: new ChatCallBudget({ lookups: 9 }),
    requestId: "req-pairing",
  });

  const secondRequest = sent[1];
  const callIds = secondRequest
    .flatMap((content) => content.parts)
    .flatMap((part) => (part.functionCall ? [part.functionCall.id] : []));
  const responseIds = secondRequest
    .flatMap((content) => content.parts)
    .flatMap((part) => (part.functionResponse ? [part.functionResponse.id] : []));
  // 보낸 기능 호출이 6건이면 기능 응답도 6건이어야 한다(실행하지 않은 2건 포함).
  assert.deepEqual(responseIds, callIds);
  assert.equal(responseIds.length, 6);
});

/* ------------------------------------------------------------------ *
 * 전체 시간 상한
 * ------------------------------------------------------------------ */

test("시간 상한이 지난 뒤 도착한 모델 응답은 받지 않는다", async () => {
  // 가짜 시계로 31초를 만든다. 실제로 30초를 기다리지 않는다.
  let elapsed = 0;
  const budget = new ChatCallBudget({ now: () => elapsed });
  const log = newLog();
  const late: SendChatTurn = async () => {
    elapsed = 31_000;
    return { turn: GENERAL_TEXT, model: "test-model" };
  };

  await assert.rejects(
    runChatTurn(ask("변동성이 뭐야?"), {
      sendTurn: late,
      lookups: fakeLookups({}, log),
      budget,
      requestId: "req-late",
    }),
    (error: unknown) =>
      error instanceof ChatBudgetExceededError &&
      error.reason === "time" &&
      // 기다림을 끊었을 뿐이므로 이미 시작된 호출을 취소했다고 말하지 않는다.
      !/취소/.test(error.message)
  );
});

test("시간 상한에 닿으면 확보한 자료까지만 보여 주고 새 하위 작업을 시작하지 않는다", async () => {
  let elapsed = 0;
  const budget = new ChatCallBudget({ now: () => elapsed });
  const log = newLog();
  let call = 0;
  const sendTurn: SendChatTurn = async () => {
    call += 1;
    if (call === 1) {
      return { turn: toolCall("find_stock", { query: "삼성전자" }), model: "test-model" };
    }
    elapsed = 31_000;
    return { turn: toolCall("list_disclosures", { stockCode: "005930", limit: 3 }), model: "test-model" };
  };

  const { payload } = await runChatTurn(ask("삼성전자 공시 알려줘."), {
    sendTurn,
    lookups: fakeLookups({ search: () => one(SAMSUNG) }, log),
    budget,
    requestId: "req-late-partial",
  });

  assert.deepEqual(log.filings, [], "시간이 끝난 뒤에는 새 조회를 시작하지 않는다");
  assert.ok(payload.verified?.notes.includes(CHAT_TIME_LIMIT_NOTE));
  assert.notEqual(payload.verified?.target, null, "확보한 자료는 그대로 보여 준다");
});

test("조회가 남은 시간보다 오래 걸리면 짧은 시간 안에 기다림을 끊는다", async () => {
  // 45초까지 걸릴 수 있는 기존 조회 함수를 대신한다. 시험은 실제로 30초를 기다리지 않는다.
  const log = newLog();
  let settled = false;
  const slow = new Promise<ChatSearchResult>((resolve) => {
    setTimeout(() => {
      settled = true;
      resolve(one(SAMSUNG));
    }, 300);
  });

  const started = Date.now();
  await assert.rejects(
    runChatTurn(ask("삼성전자 알려줘."), {
      sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성전자" }), DATA_ONLY_TEXT], []),
      lookups: {
        searchStocks: () => slow,
        listFilings: async () => ({ ok: false, reason: "corp_unmapped" }),
        priceSource: async () => ({ ok: false, reason: "base_date_unavailable" }),
      },
      budget: new ChatCallBudget({ totalTimeMs: 20 }),
      requestId: "req-slow-lookup",
    }),
    (error: unknown) => error instanceof ChatBudgetExceededError && error.reason === "time"
  );

  assert.ok(Date.now() - started < 250, "남은 시간만큼만 기다린다");
  assert.equal(settled, false, "이미 시작된 조회가 끝나기를 기다리지 않는다");
  await slow;
  assert.deepEqual(log.filings, []);
});

/* ------------------------------------------------------------------ *
 * 형식과 검사기의 경계
 * ------------------------------------------------------------------ */

test("매수·매도는 용어 설명으로는 통과하고 권유·시점 판단이면 막는다", () => {
  const pass = (points: string[]) =>
    assert.equal(
      validateChatModelAnswer({ kind: "general", summary: "매수와 매도는 거래의 방향을 가리키는 말입니다.", points })
        .points.length,
      points.length
    );

  pass(["매수는 주식을 사는 것, 매도는 파는 것을 뜻하는 용어입니다."]);
  pass(["체결은 매수 주문과 매도 주문의 조건이 맞아 거래가 이뤄진 것을 말합니다."]);
  pass(["매도 잔량은 팔려고 걸어 둔 주문의 남은 수량입니다."]);

  const reject = (point: string) =>
    assert.throws(
      () =>
        validateChatModelAnswer({
          kind: "general",
          summary: "매수와 매도는 거래의 방향을 가리키는 말입니다.",
          points: [point],
        }),
      InvalidChatAnswerError
    );

  reject("지금 매수하는 것이 좋겠습니다.");
  reject("매수를 권합니다.");
  reject("매도 시점을 지금으로 보면 됩니다.");
  reject("비중 확대 의견을 드립니다.");
});

test("정규식 검사는 문장의 뜻을 보증하지 않는다", () => {
  // 이 문장은 회사 이름도 확인된 수치도 없어 형식 검사를 통과한다. 통과가 사실 확인이 아니다.
  const answer = validateChatModelAnswer({
    kind: "general",
    summary: "반도체 업종은 경기와 재고 흐름에 따라 실적이 달라질 수 있습니다.",
    points: ["같은 업종 안에서도 회사마다 사업 구성이 달라 결과가 다르게 나타납니다."],
  });
  assert.equal(answer.kind, "general");
  // 그래서 이 문장은 화면에서 '최신 확인 자료가 아닙니다' 표시와 함께 일반 설명 영역에만 놓인다.
  assert.equal(CHAT_GENERAL_DISCLAIMER.length > 0, true);
});

test("scopeNote는 형식과 검사기에서 모두 선택이며 없으면 서버 문구를 쓴다", async () => {
  assert.deepEqual(CHAT_RESPONSE_SCHEMA.required, ["kind", "summary", "points"]);
  assert.equal("scopeNote" in CHAT_RESPONSE_SCHEMA.properties, true);

  const withoutNote = validateChatModelAnswer({ kind: "out_of_scope", summary: "", points: [] });
  assert.equal(withoutNote.scopeNote, undefined);

  const log = newLog();
  const { payload } = await runChatTurn(ask("김치찌개 끓이는 법 알려줘."), {
    sendTurn: scriptedModel([finalText({ kind: "out_of_scope", summary: "", points: [] })], []),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-scope-note",
  });
  assert.ok(payload.status?.message.includes("국내 주식 자료"), "없으면 서버가 만든 문구를 쓴다");
  assert.equal(payload.verified, null);
});

/* ------------------------------------------------------------------ *
 * 근거와 대상 묶기 (S4 회귀)
 * ------------------------------------------------------------------ */

/** 정해 둔 응답을 다 쓰면 모델 호출 자체가 실패하는 대역. network·인증 실패를 흉내낸다. */
function modelThenFailure(turns: ChatModelTurn[], error: Error, sent: ChatModelContent[][] = []): SendChatTurn {
  let index = 0;
  return async (contents) => {
    sent.push(contents.map((content) => ({ role: content.role, parts: [...content.parts] })));
    const turn = turns[index];
    index += 1;
    if (!turn) throw error;
    return { turn, model: "test-model" };
  };
}

/** 회사명으로 갈라 답하는 검색 대역. 대상이 바뀌는 순서를 그대로 재현한다. */
function searchByName(query: string): ChatSearchResult {
  if (query === "삼성전자" || query === "005930") return one(SAMSUNG);
  if (query === "SK하이닉스" || query === "000660") return one(SK);
  throw new Error(`예정하지 않은 검색어: ${query}`);
}

test("한 요청에서 대상이 바뀌면 이전 종목 근거를 현재 대상 자료로 보여 주지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여줘. 그리고 SK하이닉스는 어때?"), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }, "c-1"),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }, "c-2"),
        toolCall("find_stock", { query: "SK하이닉스" }, "c-3"),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: searchByName,
        filings: (input) => ({
          ok: true,
          from: "20250914",
          to: "20260914",
          totalCount: 42,
          items: [FILING],
          sourceStockCode: input.stockCode,
        }),
      },
      log
    ),
    budget: new ChatCallBudget({ modelCalls: 4 }),
    requestId: "req-cross-stock",
  });

  assert.equal(payload.target?.code, "000660", "마지막으로 확인한 종목이 현재 대상이다");
  assert.equal(
    payload.verified?.filings,
    null,
    "삼성전자에서 받은 공시를 SK하이닉스 자료로 보여 주지 않는다"
  );
  assert.equal(payload.verified?.price, null);
  assert.ok(payload.verified?.notes.includes(CHAT_EVIDENCE_TARGET_MISMATCH_NOTE));
});

test("대상이 바뀌면 이전 종목 대화를 모델에 넘기는 내용에서 먼저 지운다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const previousQuestion = "삼성전자 공시 보여줘.";
  const { payload } = await runChatTurn(
    ask("SK하이닉스 공시는 어때?", {
      routeCode: "005930",
      targetCode: "005930",
      history: [
        { role: "user", text: previousQuestion },
        { role: "model", text: "삼성전자 공시 목록을 표시했습니다." },
      ],
    }),
    {
      sendTurn: scriptedModel(
        [
          toolCall("find_stock", { query: "SK하이닉스" }, "c-1"),
          toolCall("list_disclosures", { stockCode: "000660", limit: 5 }, "c-2"),
          DATA_ONLY_TEXT,
        ],
        sent
      ),
      lookups: fakeLookups(
        {
          search: searchByName,
          filings: (input) => ({
            ok: true,
            from: "20250914",
            to: "20260914",
            totalCount: 4,
            items: [FILING],
            sourceStockCode: input.stockCode,
          }),
        },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-switch-history",
    }
  );

  // 첫 호출에는 이전 대화가 들어간다. 대상이 바뀐 뒤의 호출에는 남아 있지 않다.
  const textsOf = (contents: ChatModelContent[]) =>
    contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.ok(textsOf(sent[0]).includes(previousQuestion), "첫 호출에는 언어 문맥으로 들어간다");
  const afterSwitch = textsOf(sent[sent.length - 1]);
  assert.equal(afterSwitch.includes(previousQuestion), false, "화면이 지우기 전에 서버가 먼저 버린다");
  assert.equal(afterSwitch.includes("005930"), false, "이전 종목 문맥도 함께 사라진다");
  assert.ok(afterSwitch.includes("SK하이닉스 공시는 어때?"), "지금 질문은 남는다");

  // 서명·짝 규약은 유지한다. 보낸 기능 호출 수와 기능 응답 수가 같아야 한다.
  const parts = sent[sent.length - 1].flatMap((content) => content.parts);
  assert.equal(
    parts.filter((part) => part.functionCall).length,
    parts.filter((part) => part.functionResponse).length,
    "기능 호출과 기능 응답은 짝이 맞아야 한다"
  );
  assert.equal(payload.target?.code, "000660");
  assert.equal(payload.verified?.filings?.totalCount, 4);
});

test("근거는 원본이 돌려준 종목코드로 대조하고, 어긋나면 현재 대상 자료로 쓰지 않는다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 최근 종가와 공시 보여줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          toolCalls([
            { id: "p-1", name: "get_price_summary", args: { stockCode: "005930", mode: "latest" } },
            { id: "f-1", name: "list_disclosures", args: { stockCode: "005930", limit: 5 } },
          ]),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups(
        {
          search: () => one(SAMSUNG),
          // 원본이 우선주(005935) 자료를 돌려줬다. 요청 코드를 찍어 붙이지 않는다.
          price: () => priceSourceOf("20260914", "20250915", "20260914", "005935"),
          filings: () => ({
            ok: true,
            from: "20250914",
            to: "20260914",
            totalCount: 9,
            items: [FILING],
            sourceStockCode: "005935",
          }),
        },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-evidence-binding",
    }
  );

  assert.equal(payload.verified?.price, null, "다른 종목 가격을 이 종목 값으로 보여 주지 않는다");
  assert.equal(payload.verified?.filings, null, "다른 종목 공시를 이 종목 목록으로 보여 주지 않는다");
  assert.ok(payload.verified?.notes.includes(CHAT_EVIDENCE_TARGET_MISMATCH_NOTE));
  assert.equal(usage.unavailableToolCalls, 1);
});

test("정확히 일치하는 회사명이 하나면 우선주가 함께 나와도 되묻지 않는다", async () => {
  const log = newLog();
  const hits: ChatSearchResult = {
    baseDate: "20260911",
    totalFound: 2,
    capped: false,
    candidates: [SAMSUNG, SAMSUNG_PREFERRED],
  };
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: () => hits,
        filings: (input) => ({
          ok: true,
          from: "20250914",
          to: "20260914",
          totalCount: 6,
          items: [FILING],
          sourceStockCode: input.stockCode,
        }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-exact-name",
  });

  assert.equal(payload.selection, null, "이름이 정확히 하나만 일치하면 후보를 되묻지 않는다");
  assert.equal(payload.target?.code, "005930");
  assert.equal(payload.verified?.filings?.totalCount, 6);
});

test("우선주 이름을 물으면 우선주로 확인한다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자우 공시 보여줘."), {
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성전자우" }), DATA_ONLY_TEXT], []),
    lookups: fakeLookups(
      {
        search: () => ({
          baseDate: "20260911",
          totalFound: 2,
          capped: false,
          candidates: [SAMSUNG, SAMSUNG_PREFERRED],
        }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-exact-preferred",
  });

  assert.equal(payload.target?.code, "005935", "종류주 구분을 보통주로 뭉개지 않는다");
});

test("이름이 정확히 일치하지 않는 모호한 검색어는 후보 5개까지 보여 주고 하위 조회를 하지 않는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const many5: ChatSearchResult = {
    baseDate: "20260911",
    totalFound: 20,
    capped: true,
    candidates: [
      SAMSUNG,
      SAMSUNG_PREFERRED,
      { code: "009150", name: "삼성전기", market: "KOSPI", corpName: "삼성전기주식회사", baseDate: "20260911" },
      { code: "006400", name: "삼성SDI", market: "KOSPI", corpName: "삼성에스디아이", baseDate: "20260911" },
      { code: "028260", name: "삼성물산", market: "KOSPI", corpName: "삼성물산주식회사", baseDate: "20260911" },
    ],
  };
  const { payload } = await runChatTurn(ask("삼성 공시 보여줘."), {
    // 두 번째 모델 호출을 예정하지 않았다. 불리면 시험이 실패한다.
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성" })], []),
    lookups: fakeLookups({ search: () => many5 }, log),
    budget,
    requestId: "req-ambiguous-five",
  });

  assert.equal(payload.selection?.candidates.length, 5);
  assert.equal(payload.selection?.truncated, true);
  assert.deepEqual(log.filings, []);
  assert.deepEqual(log.prices, []);
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 1 });
});

/* ------------------------------------------------------------------ *
 * 최근 확인 종가와 기간 흐름 (S4 회귀)
 * ------------------------------------------------------------------ */

test("기간을 말하지 않은 최근 종가 질문은 기간을 되묻지 않고 바로 답한다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(
    ask("이 종목의 최근 확인 종가와 기준일을 알려주고, 기준일이 왜 중요한지도 설명해줘.", {
      routeCode: "005930",
      targetCode: "005930",
    }),
    {
      sendTurn: scriptedModel(
        [
          toolCall("get_price_summary", { stockCode: "005930", mode: "latest" }),
          finalText({
            kind: "general",
            summary: "가격 자료는 언제 기준의 값인지에 따라 뜻이 달라집니다.",
            points: ["기준일이 다르면 같은 종목의 값도 서로 비교하기 어렵습니다."],
          }),
        ],
        []
      ),
      lookups: fakeLookups(
        { search: () => one(SAMSUNG), price: () => priceSourceOf("20260914", "20250915", "20260914", "005930") },
        log
      ),
      budget,
      requestId: "req-latest-close",
    }
  );

  const price = latestPrice(payload);
  assert.equal(price.baseDate, "20260914");
  assert.equal(price.quoteDate, "20260914");
  assert.equal(price.endsBeforeBaseDate, false);
  assert.ok(price.close > 0);
  assert.equal("periodLabel" in price, false, "기간 요약 항목이 섞이지 않는다");
  assert.equal(usage.rejectedToolCalls, 0, "기간을 넣으라고 거절하지 않는다");
  assert.equal(
    payload.verified?.notes.includes(CHAT_PERIOD_UNCLEAR_NOTE),
    false,
    "기간을 되묻지 않는다"
  );
  assert.ok(payload.general, "왜 기준일이 중요한지는 일반 설명으로 답한다");
  assert.deepEqual(payload.steps, ["종목 찾기", "가격 요약"]);
  assert.deepEqual(budget.usage(), { modelCalls: 2, lookups: 2 });
});

test("기준일에 거래일 자료가 없으면 그 앞 거래일 종가임을 밝힌다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("이 종목 최근 종가 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [toolCall("get_price_summary", { stockCode: "005930", mode: "latest" }), DATA_ONLY_TEXT],
        []
      ),
      lookups: fakeLookups(
        // 기준일은 9월 14일인데 원본은 9월 11일까지만 있다.
        { search: () => one(SAMSUNG), price: () => priceSourceOf("20260914", "20250915", "20260911") },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-latest-close-gap",
    }
  );

  const price = latestPrice(payload);
  assert.equal(price.baseDate, "20260914");
  assert.equal(price.quoteDate, "20260911");
  assert.equal(price.endsBeforeBaseDate, true);
});

test("기간 흐름을 물었는데 기간이 없으면 임의로 고르지 않고 되묻는다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 가격 흐름 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          // 기간을 채우기 위해 12개월을 대신 고르지 않는다.
          toolCall("get_price_summary", { stockCode: "005930", mode: "range" }),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-range-no-period",
    }
  );

  assert.deepEqual(log, newLog(), "기간을 모르면 조회를 시작하지 않는다");
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 1);
  assert.equal(payload.status?.message, CHAT_PERIOD_UNCLEAR_NOTE);
  assert.equal(payload.verified, null, "요청하지 않은 기간 요약을 만들지 않는다");
});

/* ------------------------------------------------------------------ *
 * 실패했을 때 확보한 자료 (S4 회귀)
 * ------------------------------------------------------------------ */

test("마지막 AI 설명 호출이 실패해도 확인한 공시를 버리지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성전자 공시 보여줘."), {
    sendTurn: modelThenFailure(
      [toolCall("find_stock", { query: "삼성전자" }), toolCall("list_disclosures", { stockCode: "005930", limit: 5 })],
      new Error("모델 호출이 실패했습니다. (network)")
    ),
    lookups: fakeLookups(
      {
        search: () => one(SAMSUNG),
        filings: (input) => ({
          ok: true,
          from: "20250914",
          to: "20260914",
          totalCount: 12,
          items: [FILING],
          sourceStockCode: input.stockCode,
        }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-model-failure",
  });

  assert.equal(payload.verified?.filings?.totalCount, 12, "조회 결과를 비어 있는 것으로 바꾸지 않는다");
  assert.ok(payload.verified?.notes.includes(CHAT_MODEL_UNAVAILABLE_NOTE));
  assert.equal(payload.general, null, "받지 못한 설명을 만들어 채우지 않는다");
});

test("확보한 자료가 없는데 모델 호출이 실패하면 감추지 않고 실패로 알린다", async () => {
  const log = newLog();
  await assert.rejects(
    runChatTurn(ask("변동성이 뭐야?"), {
      sendTurn: modelThenFailure([], new Error("모델 호출이 실패했습니다. (auth)")),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-model-failure-empty",
    }),
    /모델 호출이 실패/
  );
});

test("실패한 조회는 같은 요청에서 다시 실행하지 않는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 공시 보여줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [
          toolCall("list_disclosures", { stockCode: "005930", limit: 5 }, "f-1"),
          toolCall("list_disclosures", { stockCode: "005930", limit: 5 }, "f-2"),
          DATA_ONLY_TEXT,
        ],
        []
      ),
      lookups: fakeLookups(
        {
          search: () => one(SAMSUNG),
          filings: () => {
            throw new Error("OpenDART 요청이 실패했습니다. (HTTP 500)");
          },
        },
        log
      ),
      budget,
      requestId: "req-failure-memo",
    }
  );

  assert.equal(log.filings.length, 1, "같은 입력의 실패한 조회를 되풀이하지 않는다");
  assert.equal(usage.reusedToolCalls, 1);
  assert.deepEqual(budget.usage(), { modelCalls: 3, lookups: 2 });
  assert.ok(payload.verified?.notes.some((note) => note.includes("자료가 없는 것과는 다릅니다")));
});

test("확인된 자료가 없는데 자료만으로 답한다고 하면 빈 답변을 그리지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("이거 알려줘."), {
    sendTurn: scriptedModel([DATA_ONLY_TEXT], []),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-data-only-empty",
  });

  assert.deepEqual(log, newLog());
  assert.equal(payload.verified, null);
  assert.equal(payload.general, null);
  assert.equal(payload.status?.message, CHAT_DATA_UNCONFIRMED.message);
  assert.ok(payload.status!.nextActions.length <= 2);
});

test("아직 확인하지 않은 화면 종목코드는 확인된 정보라고 적지 않는다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const { payload } = await runChatTurn(
    ask("변동성이 뭐야?", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel([GENERAL_TEXT], sent),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-context-label",
    }
  );

  const texts = sent[0].flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.ok(texts.includes("서버 미확인"), "미확인 화면 문맥이라고 밝힌다");
  assert.equal(texts.includes("[서버 확인 정보]"), false);
  assert.deepEqual(log, newLog(), "일반 개념 질문에는 미리 조회하지 않는다");
  assert.equal(payload.verified, null);
});

test("후보를 골라 다시 확인한 대상은 확인된 정보로 다룬다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  await runChatTurn(ask("삼성전자 공시 보여줘.", { selection: { searchQuery: "삼성", code: "005930" } }), {
    sendTurn: scriptedModel([DATA_ONLY_TEXT], sent),
    lookups: fakeLookups(
      {
        search: () => ({
          baseDate: "20260911",
          totalFound: 3,
          capped: false,
          candidates: SAMSUNG_FAMILY,
        }),
      },
      log
    ),
    budget: new ChatCallBudget(),
    requestId: "req-selection-verified",
  });

  const texts = sent[0].flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.ok(texts.includes("[서버 확인 정보]"), "실제 검색으로 대조한 대상이므로 확인된 정보다");
});

/* ------------------------------------------------------------------ *
 * 실제 호출에서 나온 지적 (2026-09-14 관찰)
 * ------------------------------------------------------------------ */

test("질문에 없는 좁은 회사명으로 검색어를 바꿔 부르면 질문에 적힌 말로 되돌려 되묻는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  // 실제 호출: '삼성 최근 공시 보여줘.'에 모델이 삼성전자를 골라 종가·공시까지 만들었다.
  const { payload, usage } = await runChatTurn(ask("삼성 최근 공시 보여줘."), {
    // 두 번째 모델 호출을 예정하지 않았다. 후보 대기 없이 이어가면 시험이 실패한다.
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성전자" })], []),
    lookups: fakeLookups({ search: () => many(SAMSUNG_FAMILY, true) }, log),
    budget,
    requestId: "req-invented-narrowing",
  });

  assert.deepEqual(log.searches, ["삼성"], "모델이 좁혀 적은 회사명이 아니라 질문에 있는 말로 검색한다");
  assert.deepEqual(log.filings, [], "사람이 고르기 전에는 공시를 조회하지 않는다");
  assert.deepEqual(log.prices, [], "사람이 고르기 전에는 가격을 조회하지 않는다");
  assert.equal(payload.selection?.searchQuery, "삼성");
  assert.equal(payload.selection?.candidates.length, 3);
  assert.equal(payload.target, null, "서버가 대신 회사를 고르지 않는다");
  assert.equal(payload.verified, null, "가격 0건·공시 0건이다");
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 1 });
  assert.equal(usage.executedToolCalls, 1);
});

test("질문에 근거가 전혀 없는 회사명으로는 검색조차 하지 않는다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(ask("이 회사 공시 보여줘."), {
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성전자" }), DATA_ONLY_TEXT], []),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-ungrounded-query",
  });

  assert.deepEqual(log, newLog(), "되돌릴 말이 없으면 조회를 시작하지 않는다");
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 1);
  assert.equal(payload.status?.message, CHAT_QUERY_NOT_GROUNDED_NOTE);
  assert.equal(payload.verified, null);
});

test("질문에 적힌 회사명·화면 종목코드는 그대로 검색해 확정한다", async () => {
  const exact = newLog();
  const { payload: byName } = await runChatTurn(ask("삼성전자 최근 공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: searchByName,
        filings: (input) => ({
          ok: true,
          from: "20250914",
          to: "20260914",
          totalCount: 42,
          items: [FILING],
          sourceStockCode: input.stockCode,
        }),
      },
      exact
    ),
    budget: new ChatCallBudget(),
    requestId: "req-grounded-exact-name",
  });

  assert.deepEqual(exact.searches, ["삼성전자"], "정확히 적은 회사명은 바꾸지 않는다");
  assert.equal(byName.target?.code, "005930");
  assert.ok(byName.verified?.filings, "확정된 대상의 공시는 그대로 보여 준다");

  const context = newLog();
  const { payload: byCode } = await runChatTurn(
    ask("이 종목 공시 보여줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel([toolCall("find_stock", { query: "005930" }), DATA_ONLY_TEXT], []),
      lookups: fakeLookups({ search: searchByName }, context),
      budget: new ChatCallBudget(),
      requestId: "req-grounded-context-code",
    }
  );

  assert.deepEqual(context.searches, ["005930"], "화면 문맥 종목코드는 검색 근거가 된다");
  assert.equal(byCode.target?.code, "005930");
});

test("요청하지 않은 기간은 형식이 맞아도 쓰지 않고 되묻는다", async () => {
  const log = newLog();
  // 실제 호출: '요즘 가격 흐름'에 모델이 1m을 넣어 요청하지 않은 1개월 요약이 나왔다.
  const { payload, usage } = await runChatTurn(
    ask("이 종목의 요즘 가격 흐름은 어때?", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [toolCall("get_price_summary", { stockCode: "005930", mode: "range", period: "1m" }), DATA_ONLY_TEXT],
        []
      ),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-unrequested-period",
    }
  );

  assert.deepEqual(log, newLog(), "질문에 없는 기간으로는 조회를 시작하지 않는다");
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 1);
  assert.equal(payload.status?.message, CHAT_PERIOD_UNCLEAR_NOTE);
  assert.equal(payload.verified, null, "요청하지 않은 1개월 요약을 만들지 않는다");
});

test("질문에 적은 기간이면 되묻지 않고 그 기간으로 요약한다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(
    ask("이 종목 세달 가격 흐름 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [toolCall("get_price_summary", { stockCode: "005930", mode: "range", period: "3m" }), DATA_ONLY_TEXT],
        []
      ),
      lookups: fakeLookups(
        { search: searchByName, price: () => priceSourceOf("20260914", "20250915", "20260914", "005930") },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-requested-period",
    }
  );

  assert.equal(rangePrice(payload).periodLabel, "3개월", "'세달'은 달력 3개월로 받는다");
  assert.equal(usage.rejectedToolCalls, 0);
  assert.equal(
    payload.verified?.notes.includes(CHAT_PERIOD_UNCLEAR_NOTE),
    false,
    "요약이 만들어졌으면 되묻는 문구를 남기지 않는다"
  );
});

test("대상을 바꾼 뒤 이전 종목을 다시 물으면 대상과 근거를 함께 되돌린다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(ask("삼성전자 공시 보여줘. SK하이닉스도 알려줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자" }, "c-1"),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }, "c-2"),
        toolCall("find_stock", { query: "SK하이닉스" }, "c-3"),
        // 같은 입력으로 다시 부른다. memo만 돌려주면 모델이 아는 값과 화면 근거가 어긋난다.
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }, "c-4"),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups(
      {
        search: searchByName,
        filings: (input) => ({
          ok: true,
          from: "20250914",
          to: "20260914",
          totalCount: 42,
          items: [FILING],
          sourceStockCode: input.stockCode,
        }),
      },
      log
    ),
    budget: new ChatCallBudget({ modelCalls: 5 }),
    requestId: "req-cached-other-target",
  });

  assert.deepEqual(log.filings, [{ stockCode: "005930", limit: 5 }], "공시 조회는 한 번만 한다");
  assert.equal(usage.reusedToolCalls, 1);
  assert.equal(payload.target?.code, "005930", "다시 물은 종목이 현재 대상이 된다");
  assert.equal(payload.target?.name, "삼성전자");
  assert.equal(payload.verified?.filings?.items.length, 1, "되돌린 대상의 공시를 함께 보여 준다");
  assert.equal(payload.verified?.price, null, "두 종목 자료가 섞이지 않는다");
});

test("기간 표현 판정은 책에 적은 표현만 지원하고 나머지는 되묻게 남긴다", () => {
  const periods = (question: string) => [...chatQuestionPeriods(question)].sort();

  assert.deepEqual(periods("이 종목 1개월 흐름"), ["1m"]);
  assert.deepEqual(periods("한 달 동안 어땠어?"), ["1m"]);
  assert.deepEqual(periods("3개월 흐름 알려줘"), ["3m"]);
  assert.deepEqual(periods("석달치 흐름"), ["3m"]);
  assert.deepEqual(periods("12개월 흐름"), ["12m"]);
  assert.deepEqual(periods("1년 흐름"), ["12m"]);

  // 지원하지 않는 기간과 막연한 표현은 "기간이 적혀 있다"고 보지 않는다. 정규식이 문장의
  // 뜻을 아는 것이 아니므로, 모르는 표현은 되묻는 쪽으로 남긴다.
  assert.deepEqual(periods("6개월 흐름"), []);
  assert.deepEqual(periods("요즘 가격 흐름은 어때?"), []);
  assert.deepEqual(periods("최근 흐름 알려줘"), []);
  assert.deepEqual(periods("2년 흐름"), []);
});

/**
 * 실제 호출에서 나온 한글 수사 부분 일치. `십삼개월`의 `삼개월`, `십일년`의 `일년`이 걸려
 * 지원하지 않는 기간이 지원 기간으로 읽혔다. 지원 표현은 그대로 살아 있어야 한다.
 */
test("한글 수사 안의 부분 일치를 지원 기간으로 읽지 않는다", () => {
  const periods = (question: string) => [...chatQuestionPeriods(question)].sort();

  assert.deepEqual(periods("최근 십삼개월 가격"), [], "십삼개월을 3개월로 읽지 않는다");
  assert.deepEqual(periods("최근 십일년 흐름"), [], "십일년을 12개월로 읽지 않는다");
  assert.deepEqual(periods("십일개월 흐름"), [], "십일개월을 1개월로 읽지 않는다");
  assert.deepEqual(periods("이십사개월 흐름"), []);

  // 지원하는 표현은 그대로 읽는다.
  assert.deepEqual(periods("십이개월 흐름"), ["12m"]);
  assert.deepEqual(periods("열두달 흐름"), ["12m"]);
  assert.deepEqual(periods("삼개월 흐름"), ["3m"]);
  assert.deepEqual(periods("일개월 흐름"), ["1m"]);
  assert.deepEqual(periods("일년 흐름"), ["12m"]);
});

/* ------------------------------------------------------------------ *
 * 기간 되묻기: 모델이 기능을 부르지 않고 되물을 때 (실제 호출 회귀)
 * ------------------------------------------------------------------ */

test("기간만 모르는 되묻기에 어느 종목인지 묻지 않는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  // 실제 호출: 상세 화면(005930)에서 '요즘 가격 흐름'을 물었더니 모델이 기능을 부르지 않고
  // 되물었는데, 서버가 그 뜻을 잃고 "어느 종목인지 알 수 없다"로 끝냈다.
  const { payload, usage } = await runChatTurn(
    ask("이 종목의 요즘 가격 흐름은 어때?", { routeCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [finalText({ kind: "price_period_request", summary: "어느 기간인지 알려 주세요.", points: [] })],
        []
      ),
      lookups: fakeLookups({}, log),
      budget,
      requestId: "req-period-clarification",
    }
  );

  assert.deepEqual(log, newLog(), "되묻는 답에서는 조회를 시작하지 않는다");
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 0 });
  assert.equal(usage.executedToolCalls, 0);
  assert.equal(usage.rejectedToolCalls, 0);
  assert.deepEqual(payload.steps, []);
  assert.equal(payload.verified, null, "요청하지 않은 기간 요약을 만들지 않는다");
  assert.equal(payload.general, null);
  assert.equal(payload.status?.message, CHAT_PERIOD_CLARIFICATION.message);
  assert.equal(payload.status?.message, CHAT_PERIOD_UNCLEAR_NOTE);
  assert.notEqual(payload.status?.message, CHAT_TARGET_UNKNOWN.message);
  assert.ok(payload.status!.nextActions.length <= 2);
  assert.ok(
    payload.status!.nextActions.every((action) => !action.includes("종목코드")),
    "이미 정해진 종목을 다시 적으라고 하지 않는다"
  );
});

test("종목도 정해지지 않았으면 기간 되묻기 대신 종목을 되묻는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("요즘 가격 흐름은 어때?"), {
    sendTurn: scriptedModel(
      [finalText({ kind: "price_period_request", summary: "어느 기간인지 알려 주세요.", points: [] })],
      []
    ),
    lookups: fakeLookups({}, log),
    budget: new ChatCallBudget(),
    requestId: "req-period-without-target",
  });

  assert.deepEqual(log, newLog());
  assert.equal(payload.status?.message, CHAT_TARGET_UNKNOWN.message, "기간이 아니라 종목이 빠졌다");
});

test("질문에 기간이 적혀 있으면 모델이 되묻자고 해도 기간 문구를 만들지 않는다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("이 종목 3개월 가격 흐름 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [finalText({ kind: "price_period_request", summary: "어느 기간인지 알려 주세요.", points: [] })],
        []
      ),
      lookups: fakeLookups({}, log),
      budget: new ChatCallBudget(),
      requestId: "req-period-not-grounded",
    }
  );

  assert.deepEqual(log, newLog());
  assert.equal(payload.verified, null);
  assert.notEqual(payload.status?.message, CHAT_PERIOD_UNCLEAR_NOTE, "되물을 근거가 없다");
  assert.equal(payload.status?.message, CHAT_DATA_UNCONFIRMED.message);
});

test("기간을 되묻는 종류라도 최근 확인 종가 경로는 그대로다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(
    ask("이 종목 최근 종가 알려줘.", { routeCode: "005930", targetCode: "005930" }),
    {
      sendTurn: scriptedModel(
        [toolCall("get_price_summary", { stockCode: "005930", mode: "latest" }), DATA_ONLY_TEXT],
        []
      ),
      lookups: fakeLookups(
        { search: searchByName, price: () => priceSourceOf("20260914", "20250915", "20260914", "005930") },
        log
      ),
      budget: new ChatCallBudget(),
      requestId: "req-latest-still-works",
    }
  );

  assert.equal(latestPrice(payload).baseDate, "20260914");
  assert.equal(payload.status, null, "기간을 되묻지 않는다");
});

/* ------------------------------------------------------------------ *
 * 종목코드 계약을 지원하지 않는 후보 (실제 호출 회귀)
 * ------------------------------------------------------------------ */

/** 실제 `삼성` 검색 결과의 모양. 다섯째 자리가 글자인 `0044K0`이 후보에 섞여 있었다. */
const SAMSUNG_SPAC = {
  code: "0044K0",
  name: "삼성스팩10호",
  market: "KOSDAQ",
  corpName: "삼성기업인수목적10호(주)",
  baseDate: "20260911",
};
const LIVE_SAMSUNG_HITS: ChatSearchResult = {
  baseDate: "20260911",
  totalFound: 20,
  capped: true,
  candidates: [
    { code: "006660", name: "삼성공조", market: "KOSPI", corpName: "삼성공조(주)", baseDate: "20260911" },
    { code: "028260", name: "삼성물산", market: "KOSPI", corpName: "삼성물산(주)", baseDate: "20260911" },
    { code: "207940", name: "삼성바이오로직스", market: "KOSPI", corpName: "삼성바이오로직스(주)", baseDate: "20260911" },
    { code: "032830", name: "삼성생명", market: "KOSPI", corpName: "삼성생명보험(주)", baseDate: "20260911" },
    SAMSUNG_SPAC,
  ],
};

test("고를 수 없는 종목코드는 후보에 넣지 않고 잘렸다는 사실을 밝힌다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask("삼성 공시 보여줘."), {
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성" })], []),
    lookups: fakeLookups({ search: () => LIVE_SAMSUNG_HITS }, log),
    budget: new ChatCallBudget(),
    requestId: "req-unsupported-candidate",
  });

  const codes = payload.selection?.candidates.map((candidate) => candidate.code) ?? [];
  assert.deepEqual(codes, ["006660", "028260", "207940", "032830"]);
  assert.equal(codes.includes(SAMSUNG_SPAC.code), false, "고를 수 없는 후보를 단추로 만들지 않는다");
  assert.equal(payload.selection?.totalFound, 20, "찾은 건수는 그대로 밝힌다");
  assert.equal(payload.selection?.truncated, true, "보여 준 수가 찾은 건수보다 적다");
  assert.ok(payload.selection!.message.includes("1건"), "왜 후보가 줄었는지 밝힌다");
  assert.equal(payload.target, null);
});

test("지원하지 않는 종목코드만 정확히 일치하면 확정하지 않고 그대로 밝힌다", async () => {
  const log = newLog();
  const onlySpac: ChatSearchResult = {
    baseDate: "20260911",
    totalFound: 1,
    capped: false,
    candidates: [SAMSUNG_SPAC],
  };
  const { payload, usage } = await runChatTurn(ask("삼성스팩10호 공시 보여줘."), {
    sendTurn: scriptedModel(
      [toolCall("find_stock", { query: "삼성스팩10호" }), DATA_ONLY_TEXT],
      []
    ),
    lookups: fakeLookups({ search: () => onlySpac }, log),
    budget: new ChatCallBudget(),
    requestId: "req-unsupported-exact",
  });

  assert.deepEqual(log.filings, [], "확정하지 않았으므로 하위 조회를 하지 않는다");
  assert.equal(payload.selection, null, "고를 수 없는 후보로 선택 단추를 만들지 않는다");
  assert.equal(payload.target, null, "종목코드 계약을 넓혀 확정하지 않는다");
  assert.equal(payload.status?.message, CHAT_CODE_UNSUPPORTED_NOTE);
  assert.equal(usage.executedToolCalls, 1);
});

/* ------------------------------------------------------------------ *
 * 조사가 붙은 검색어 (2026-09-14 실제 응답 재검증 실패, S22-01)
 *
 * 실제 응답에서 `삼성전자의 최근 공시 5건을 …` 질문이 `종목 찾기`까지만 하고
 * `어느 종목의 자료인지 알 수 없습니다`로 끝났다. 검색은 실제로 실행됐고 0건이었다.
 * 아래 대역은 실제 검색과 같은 뜻(종목명 부분일치)만 흉내내므로, 조사가 붙은 말은 0건이다.
 * ------------------------------------------------------------------ */

/** 재검증에서 실패한 질문 원문. 조사(`~의`)와 뒤따르는 말이 붙어 있다. */
const PARTICLE_QUESTION = "삼성전자의 최근 공시 5건을 DART 원문과 함께 보여줘.";

const FIVE_FILINGS = Array.from({ length: 5 }, (_unused, index) => ({
  ...FILING,
  receiptNo: `2026090800012${index}`,
  documentUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=2026090800012${index}`,
}));

/**
 * 실제 검색(`likeItmsNm`)과 같은 뜻으로만 맞춘다. **종목명 부분일치와 종목코드 일치**뿐이다.
 * 조사가 붙은 말이나 문장은 어떤 종목명에도 들어 있지 않으므로 0건이 된다.
 */
function partialNameSearch(listing: (typeof SAMSUNG)[]): (query: string) => ChatSearchResult {
  return (query) => {
    const isExact = (item: typeof SAMSUNG) => item.name === query || item.code === query;
    const hits = [
      ...listing.filter(isExact),
      ...listing.filter((item) => !isExact(item) && item.name.includes(query)),
    ];
    return { baseDate: "20260911", totalFound: hits.length, capped: false, candidates: hits };
  };
}

function filingsOf(items: typeof FIVE_FILINGS) {
  return (input: { stockCode: string; limit: number }): ChatFilingsResult => ({
    ok: true,
    from: "20250914",
    to: "20260914",
    totalCount: 42,
    items: items.slice(0, input.limit),
    sourceStockCode: input.stockCode,
  });
}

test("조사가 붙은 검색어는 질문에 있는 더 짧은 꼴을 되돌려 줄 후보로 함께 알려 준다", () => {
  const ground = (query: string) =>
    groundChatSearchQuery({ query, question: PARTICLE_QUESTION, contextCodes: [], confirmedTargets: [] });

  const withParticle = ground("삼성전자의");
  assert.equal(withParticle.ok && withParticle.query, "삼성전자의", "질문에 있는 말이므로 그대로 검색한다");
  assert.equal(withParticle.ok && withParticle.fallback, "삼성전자");

  const sentence = ground("삼성전자의 최근 공시");
  assert.equal(sentence.ok && sentence.fallback, "삼성전자", "여러 낱말이면 첫 낱말에서 조사를 뗀다");

  // 되돌려 줄 말은 **질문에 글자 그대로 있는 말**이어야 한다. 회사명을 지어내지 않는다는 근거다.
  const mentions = chatQuestionMentions(PARTICLE_QUESTION);
  assert.ok(mentions.includes("삼성전자"), String(withParticle.ok && withParticle.fallback));

  const exactName = ground("삼성전자");
  assert.equal(exactName.ok && exactName.fallback, null, "이미 회사명이면 더 줄이지 않는다");
  const byCode = groundChatSearchQuery({
    query: "005930",
    question: "005930 공시 보여줘.",
    contextCodes: [],
    confirmedTargets: [],
  });
  assert.equal(byCode.ok && byCode.fallback, null, "종목코드는 줄이지 않는다");
});

test("조사가 붙은 검색어가 0건이면 질문에 적힌 회사명으로 한 번 더 검색해 확정한다", async () => {
  const log = newLog();
  const sent: ChatModelContent[][] = [];
  const budget = new ChatCallBudget();
  const { payload, usage } = await runChatTurn(ask(PARTICLE_QUESTION), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자의" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      sent
    ),
    lookups: fakeLookups({ search: partialNameSearch([SAMSUNG, SAMSUNG_PREFERRED]), filings: filingsOf(FIVE_FILINGS) }, log),
    budget,
    requestId: "req-particle-exact-name",
  });

  assert.deepEqual(log.searches, ["삼성전자의", "삼성전자"], "0건일 때만 더 짧은 꼴로 한 번 더 검색한다");
  assert.deepEqual(log.filings, [{ stockCode: "005930", limit: 5 }]);
  assert.equal(payload.target?.code, "005930");
  assert.equal(payload.verified?.filings?.shownCount, 5);
  assert.equal(payload.verified?.filings?.requestedCount, 5);
  assert.equal(payload.verified?.filings?.items[0].documentUrl, FIVE_FILINGS[0].documentUrl);
  assert.equal(payload.status, null, "명시한 회사를 확인했으므로 어느 종목인지 되묻지 않는다");
  assert.equal(payload.selection, null);
  assert.deepEqual(payload.steps, ["종목 찾기", "공시 조회"]);
  // 재검색도 조회 예산을 한 번 더 쓴다. 두 번을 한 번으로 숨기지 않는다.
  assert.deepEqual(budget.usage(), { modelCalls: 3, lookups: 3 });
  assert.equal(usage.executedToolCalls, 2, "재검색은 같은 기능 호출 하나 안에서 끝난다");

  // 모델에는 무엇으로 검색했는지 그대로 알린다.
  const responses = responsesSentTo(sent);
  assert.equal(responses[0].searchedQuery, "삼성전자");
  assert.ok(String(responses[0].note).includes("삼성전자의"), "0건이었던 말도 숨기지 않는다");
});

test("질문 문장을 그대로 베낀 여러 낱말 검색어도 첫 낱말의 회사명으로 한 번만 다시 검색한다", async () => {
  const log = newLog();
  const { payload } = await runChatTurn(ask(PARTICLE_QUESTION), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "삼성전자의 최근 공시" }),
        toolCall("list_disclosures", { stockCode: "005930", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups({ search: partialNameSearch([SAMSUNG]), filings: filingsOf(FIVE_FILINGS) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-particle-sentence",
  });

  assert.deepEqual(log.searches, ["삼성전자의 최근 공시", "삼성전자"]);
  assert.equal(payload.target?.code, "005930");
});

test("더 짧은 꼴로 찾은 후보가 여럿이면 실제로 검색한 말로 사람에게 되묻는다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload } = await runChatTurn(ask("삼성의 최근 공시를 보여줘."), {
    // 후보 대기로 끝나므로 두 번째 모델 호출을 예정하지 않는다.
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성의" })], []),
    lookups: fakeLookups(
      { search: (query) => (query === "삼성" ? many(SAMSUNG_FAMILY, true) : partialNameSearch([])(query)) },
      log
    ),
    budget,
    requestId: "req-particle-ambiguous",
  });

  assert.deepEqual(log.searches, ["삼성의", "삼성"]);
  assert.deepEqual(log.filings, [], "사람이 고르기 전에는 하위 조회를 하지 않는다");
  assert.equal(payload.selection?.searchQuery, "삼성", "보여 주는 말은 실제로 검색한 말이다");
  assert.equal(payload.selection?.candidates.length, 3);
  assert.equal(payload.target, null, "서버가 대신 회사를 고르지 않는다");
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 2 });
});

test("검색이 1건 이상이면 이름 끝이 조사 글자와 겹쳐도 다시 검색하지 않는다", async () => {
  const log = newLog();
  /*
   * 실제 종목이 아니라, **이름 끝 글자가 조사(`도`)와 겹치는 경우**를 만들기 위한 시험용 값이다.
   * 이런 이름은 첫 검색이 1건 이상이므로 두 번째 검색 자체가 일어나지 않는다.
   */
  const particleTail = {
    code: "999210",
    name: "시험전자도",
    market: "KOSPI",
    corpName: "시험전자도주식회사",
    baseDate: "20260911",
  };
  const shorter = { ...particleTail, code: "999220", name: "시험전자" };
  const { payload } = await runChatTurn(ask("시험전자도 공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "시험전자도" }),
        toolCall("list_disclosures", { stockCode: "999210", limit: 5 }),
        DATA_ONLY_TEXT,
      ],
      []
    ),
    lookups: fakeLookups({ search: partialNameSearch([particleTail, shorter]), filings: filingsOf(FIVE_FILINGS) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-particle-tail-name",
  });

  assert.deepEqual(log.searches, ["시험전자도"], "조사를 뗀 이름의 다른 종목으로 넓히지 않는다");
  assert.equal(payload.target?.code, "999210");
});

test("0건이고 질문에 더 짧은 꼴이 없으면 검색은 한 번뿐이고 자료 없음으로 남는다", async () => {
  const log = newLog();
  const { payload, usage } = await runChatTurn(ask("시험없는회사 공시 보여줘."), {
    sendTurn: scriptedModel(
      [
        toolCall("find_stock", { query: "시험없는회사" }),
        finalText({ kind: "stock_data_request", summary: "어느 종목인지 확인하지 못했습니다.", points: [] }),
      ],
      []
    ),
    lookups: fakeLookups({ search: partialNameSearch([SAMSUNG]) }, log),
    budget: new ChatCallBudget(),
    requestId: "req-particle-no-fallback",
  });

  assert.deepEqual(log.searches, ["시험없는회사"], "되돌릴 말이 없으면 두 번째 검색을 만들지 않는다");
  assert.equal(usage.executedToolCalls, 1);
  assert.equal(payload.target, null);
  assert.equal(payload.verified, null);
});

test("모델이 질문에 없는 회사로 좁히면 조사가 붙어 있어도 되돌린 말로만 한 번 검색한다", async () => {
  const log = newLog();
  const budget = new ChatCallBudget();
  const { payload } = await runChatTurn(ask("삼성의 최근 공시를 보여줘."), {
    sendTurn: scriptedModel([toolCall("find_stock", { query: "삼성전자" })], []),
    lookups: fakeLookups({ search: () => many(SAMSUNG_FAMILY, true) }, log),
    budget,
    requestId: "req-particle-keeps-no-narrowing",
  });

  assert.deepEqual(log.searches, ["삼성"], "좁혀 적은 회사명으로는 검색하지 않고, 1건 이상이면 재검색도 없다");
  assert.equal(payload.selection?.searchQuery, "삼성");
  assert.equal(payload.target, null);
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 1 });
});

test("지원하지 않는 코드가 함께 정확히 일치하면 하나로 확정하지 않는다", () => {
  const sameName = { ...SAMSUNG_SPAC, code: "005930" };
  const both: Parameters<typeof uniqueExactMatch>[1] = {
    totalFound: 2,
    capped: false,
    candidates: [sameName],
    unsupported: [SAMSUNG_SPAC],
  };
  assert.equal(uniqueExactMatch(SAMSUNG_SPAC.name, both), null);

  // 뺀 항목 가운데 정확 일치가 없으면 원래 판정 그대로다.
  assert.equal(
    uniqueExactMatch(SAMSUNG_SPAC.name, { ...both, unsupported: [{ ...SAMSUNG_SPAC, name: "삼성스팩11호" }] })?.code,
    "005930"
  );
});
