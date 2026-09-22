/**
 * AI가 제안할 수 있는 조회 기능의 목록과 입력 검사.
 * 이름과 형식은 여기서만 정하고, 실제 실행은 서버 전용 Adapter가 한다.
 * 여기 있는 세 이름이 전부다. 목록에 없는 이름, 형식이 어긋난 입력은 실행하지 않는다.
 */

import {
  CHAT_MAX_CANDIDATES,
  CHAT_MAX_FILINGS,
  CHAT_MAX_SEARCH_QUERY_LENGTH,
  CHAT_MIN_FILINGS,
  isChatStockCode,
} from "./chat-contract";

export const CHAT_TOOL_NAMES = ["find_stock", "list_disclosures", "get_price_summary"] as const;
export type ChatToolName = (typeof CHAT_TOOL_NAMES)[number];

/** 한 모델 응답에서 받아 줄 도구 제안 수. 넘는 제안은 실행하지 않는다. */
export const CHAT_MAX_TOOL_CALLS_PER_TURN = 4;

/** 지원하는 가격 기간. 임의 시작·종료일은 받지 않는다. */
export const CHAT_PRICE_PERIODS = ["1m", "3m", "12m"] as const;
export type ChatPricePeriod = (typeof CHAT_PRICE_PERIODS)[number];

/**
 * 가격 기능의 두 가지 방식. **기능 이름은 하나 그대로다**(네 번째 도구를 만들지 않는다).
 *
 * - `latest`: 최근 확인 종가 하나와 그 기준일만 받는다. 기간을 넣지 않는다.
 *   "최근 확인 종가와 기준일" 같은 질문은 기간이 필요 없으므로 되묻지 않고 바로 답한다.
 * - `range`: 달력 1·3·12개월 흐름 요약을 받는다. 이때만 `period`가 필요하다.
 *
 * 기간을 억지로 채우려고 12개월을 고르지 않는다. 사용자가 요청하지 않은 기간 요약은 만들지 않는다.
 */
export const CHAT_PRICE_MODES = ["latest", "range"] as const;
export type ChatPriceMode = (typeof CHAT_PRICE_MODES)[number];

/** 화면에 보여 줄 사용자 언어 이름. 내부 함수명·도구명을 그대로 노출하지 않는다. */
export const CHAT_TOOL_STEP_LABEL: Record<ChatToolName, string> = {
  find_stock: "종목 찾기",
  list_disclosures: "공시 조회",
  get_price_summary: "가격 요약",
};

/**
 * 모델에 넘길 함수 선언. `parametersJsonSchema`는 설치된 SDK(@google/genai 2.18.0)의
 * FunctionDeclaration 필드다. 서버가 같은 규칙으로 다시 검사하므로 이 선언만 믿지 않는다.
 */
export const CHAT_TOOL_DECLARATIONS = [
  {
    name: "find_stock" satisfies ChatToolName,
    description:
      "회사명이나 종목코드로 실제 상장종목을 확인한다. 대상이 정해지지 않은 종목 자료 질문에서 가장 먼저 부른다. 결과가 여럿이면 사용자가 고를 때까지 다음 조회를 하지 않는다.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          minLength: 1,
          maxLength: CHAT_MAX_SEARCH_QUERY_LENGTH,
          description: "질문에 나온 회사명 또는 여섯 자리 종목코드. 문장을 그대로 넣지 않는다.",
        },
      },
      required: ["query"],
    },
    responseJsonSchema: {
      type: "object",
      properties: {
        confirmed: { type: "boolean" },
        totalFound: { type: "integer" },
        candidates: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    name: "list_disclosures" satisfies ChatToolName,
    description:
      "확인된 한 종목의 최근 1년 안 공시를 접수일 최신순으로 최대 5건 받는다. 공시 본문은 읽지 않는다. 확인되지 않은 종목코드로 부르면 실행되지 않는다.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        stockCode: {
          type: "string",
          description: "find_stock으로 확인했거나 서버가 알려 준 여섯 자리 종목코드.",
        },
        limit: {
          type: "integer",
          minimum: CHAT_MIN_FILINGS,
          maximum: CHAT_MAX_FILINGS,
          description: "받을 공시 건수. 생략하면 5건이다.",
        },
      },
      required: ["stockCode"],
    },
    responseJsonSchema: {
      type: "object",
      properties: {
        totalCount: { type: "integer" },
        filings: { type: "array", items: { type: "object" } },
      },
    },
  },
  {
    name: "get_price_summary" satisfies ChatToolName,
    description:
      "확인된 한 종목의 가격을 받는다. mode=latest면 최근 확인 종가 하나와 그 기준일만 받고 기간은 넣지 않는다. mode=range면 달력 1개월·3개월·12개월 흐름 요약을 받고 period가 필요하다. 임의 날짜 구간은 지원하지 않는다.",
    parametersJsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        stockCode: {
          type: "string",
          description: "find_stock으로 확인했거나 서버가 알려 준 여섯 자리 종목코드.",
        },
        mode: {
          type: "string",
          enum: [...CHAT_PRICE_MODES],
          description:
            "latest=최근 확인 종가와 기준일만(기간 없음). range=기간 흐름 요약(period 필요). 기간을 말하지 않은 '최근 종가' 질문은 latest다.",
        },
        period: {
          type: "string",
          enum: [...CHAT_PRICE_PERIODS],
          description:
            "mode=range일 때만 넣는다. 1m=1개월, 3m=3개월, 12m=12개월. 사용자가 기간을 말하지 않았으면 임의로 고르지 말고 mode=latest를 쓰거나 되물어라.",
        },
      },
      required: ["stockCode", "mode"],
    },
    responseJsonSchema: {
      type: "object",
      properties: { available: { type: "boolean" }, mode: { type: "string" } },
    },
  },
] as const;

export type ValidatedChatToolCall =
  | { name: "find_stock"; args: { query: string } }
  | { name: "list_disclosures"; args: { stockCode: string; limit: number } }
  | { name: "get_price_summary"; args: { stockCode: string; mode: "latest" } }
  | { name: "get_price_summary"; args: { stockCode: string; mode: "range"; period: ChatPricePeriod } };

/**
 * 실행하지 않고 모델에 돌려보낼 거절. 요청 전체를 실패로 만들지 않는다.
 * `reason`은 사용자에게 되물어야 하는 거절을 구분하기 위한 값이다(기간 미확정 등).
 */
export class ChatToolCallRejectedError extends Error {
  constructor(
    message: string,
    readonly reason?: "period"
  ) {
    super(message);
    this.name = "ChatToolCallRejectedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(args: Record<string, unknown>, allowed: string[]): void {
  const extra = Object.keys(args).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new ChatToolCallRejectedError(`허용하지 않은 입력 항목이 있습니다: ${extra.join(", ")}`);
  }
}

/**
 * 검색어에 URL·경로·따옴표·명령 구분자가 있으면 실행하지 않는다.
 * 회사명에 쓰이는 한글·영문·숫자·공백과 `&`, `.`, `-`만 남긴다.
 */
const SEARCH_QUERY_PATTERN = /^[\p{Script=Hangul}A-Za-z0-9 .&-]+$/u;

function validateSearchQuery(value: unknown): string {
  if (typeof value !== "string") {
    throw new ChatToolCallRejectedError("검색어가 문자열이 아닙니다.");
  }
  const query = value.trim();
  if (query.length === 0) {
    throw new ChatToolCallRejectedError("검색어가 비어 있습니다.");
  }
  if (query.length > CHAT_MAX_SEARCH_QUERY_LENGTH) {
    throw new ChatToolCallRejectedError(
      `검색어는 ${CHAT_MAX_SEARCH_QUERY_LENGTH}자까지 쓸 수 있습니다. 회사명이나 종목코드만 넣으세요.`
    );
  }
  if (!SEARCH_QUERY_PATTERN.test(query)) {
    throw new ChatToolCallRejectedError("검색어에 회사명·종목코드가 아닌 문자가 있습니다.");
  }
  return query;
}

function validateStockCode(value: unknown): string {
  if (!isChatStockCode(value)) {
    throw new ChatToolCallRejectedError("종목코드 형식이 올바르지 않습니다. 먼저 종목을 확인하세요.");
  }
  return value;
}

function validateFilingLimit(value: unknown): number {
  if (value === undefined || value === null) {
    return CHAT_MAX_FILINGS;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < CHAT_MIN_FILINGS || value > CHAT_MAX_FILINGS) {
    throw new ChatToolCallRejectedError(
      `공시 건수는 ${CHAT_MIN_FILINGS}에서 ${CHAT_MAX_FILINGS} 사이의 정수만 됩니다.`
    );
  }
  return value;
}

/**
 * 기간은 기본값을 두지 않는다. 빠졌거나 지원하지 않는 값이면 임의로 고르지 않고 거절하고,
 * 어느 기간인지 사용자에게 되묻도록 `period` 사유를 붙인다.
 * 이 검사는 `mode=range`에서만 부른다. `mode=latest`는 기간을 쓰지 않으므로 되묻지 않는다.
 */
function validatePeriod(value: unknown): ChatPricePeriod {
  if (typeof value !== "string" || !(CHAT_PRICE_PERIODS as readonly string[]).includes(value)) {
    throw new ChatToolCallRejectedError(
      `지원하는 기간은 ${CHAT_PRICE_PERIODS.join(", ")}입니다. 임의 날짜 구간은 지원하지 않습니다. 어느 기간인지 사용자에게 되물으세요.`,
      "period"
    );
  }
  return value as ChatPricePeriod;
}

/**
 * 방식은 반드시 명시해야 한다. 빠졌으면 서버가 고르지 않는다.
 *
 * 기간(`period`)만 있고 방식이 없으면 흐름 요약을 뜻한 것이 분명하므로 `range`로 읽는다.
 * 둘 다 없으면 무엇을 물었는지 알 수 없으므로 거절한다. 이때 기간을 되묻지는 않는다
 * (기간이 아니라 방식이 빠진 것이므로 `period` 사유를 붙이지 않는다).
 */
function validatePriceMode(value: unknown, hasPeriod: boolean): ChatPriceMode {
  if (value === undefined || value === null) {
    if (hasPeriod) return "range";
    throw new ChatToolCallRejectedError(
      "가격 방식을 밝히지 않았습니다. 최근 확인 종가만 필요하면 mode=latest, 기간 흐름이 필요하면 mode=range와 period를 넣으세요."
    );
  }
  if (typeof value !== "string" || !(CHAT_PRICE_MODES as readonly string[]).includes(value)) {
    throw new ChatToolCallRejectedError(
      `가격 방식은 ${CHAT_PRICE_MODES.join(", ")}만 됩니다.`
    );
  }
  return value as ChatPriceMode;
}

/** 이름과 입력을 함께 검사한다. 통과한 값만 실행 후보가 된다. */
export function validateChatToolCall(name: unknown, rawArgs: unknown): ValidatedChatToolCall {
  if (typeof name !== "string" || !(CHAT_TOOL_NAMES as readonly string[]).includes(name)) {
    throw new ChatToolCallRejectedError(
      `사용할 수 없는 기능입니다. 허용한 기능은 ${CHAT_TOOL_NAMES.join(", ")}뿐입니다.`
    );
  }
  const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
  if (!isRecord(args)) {
    throw new ChatToolCallRejectedError("입력 형식이 올바르지 않습니다.");
  }

  if (name === "find_stock") {
    assertOnlyKeys(args, ["query"]);
    return { name, args: { query: validateSearchQuery(args.query) } };
  }
  if (name === "list_disclosures") {
    assertOnlyKeys(args, ["stockCode", "limit"]);
    return {
      name,
      args: { stockCode: validateStockCode(args.stockCode), limit: validateFilingLimit(args.limit) },
    };
  }
  assertOnlyKeys(args, ["stockCode", "mode", "period"]);
  const stockCode = validateStockCode(args.stockCode);
  const hasPeriod = args.period !== undefined && args.period !== null;
  const mode = validatePriceMode(args.mode, hasPeriod);
  if (mode === "latest") {
    // 최근 확인 종가에는 기간이 없다. 함께 온 기간은 쓰지 않는다(요청하지 않은 기간 요약을
    // 만들지 않기 위해서다). 형식 오류로 요청 전체를 실패시키지도 않는다.
    return { name: "get_price_summary", args: { stockCode, mode } };
  }
  return {
    name: "get_price_summary",
    args: { stockCode, mode, period: validatePeriod(args.period) },
  };
}

/**
 * 같은 HTTP 요청 안에서 같은 기능·같은 검증된 입력을 다시 실행하지 않기 위한 key다.
 * HTTP 재요청 사이의 중복 제거는 보장하지 않는다.
 */
export function chatToolCallKey(call: ValidatedChatToolCall): string {
  if (call.name === "find_stock") {
    return `find_stock:${call.args.query.toLowerCase()}`;
  }
  if (call.name === "list_disclosures") {
    return `list_disclosures:${call.args.stockCode}:${call.args.limit}`;
  }
  // 방식이 다르면 다른 요청이다. 최근 종가와 기간 요약을 같은 결과로 재사용하지 않는다.
  return call.args.mode === "latest"
    ? `get_price_summary:${call.args.stockCode}:latest`
    : `get_price_summary:${call.args.stockCode}:range:${call.args.period}`;
}

/** 후보를 몇 개까지 보여 줄지. 자른 목록이라는 사실은 따로 표시한다. */
export const CHAT_CANDIDATE_LIMIT = CHAT_MAX_CANDIDATES;
