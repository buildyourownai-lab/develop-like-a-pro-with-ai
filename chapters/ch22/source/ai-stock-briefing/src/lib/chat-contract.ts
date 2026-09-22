/**
 * 챗봇 요청 계약. 서버와 브라우저가 같은 한계를 공유한다.
 * 여기에는 순수 함수만 둔다. 외부 호출·환경변수 읽기는 서버 전용 파일에서 한다.
 */

/** 질문 한 번의 최대 길이. 브라우저와 서버가 같은 값으로 막는다. */
export const CHAT_MAX_QUESTION_LENGTH = 1_000;
/** 언어 문맥으로만 쓰는 최근 왕복 수. 3회 왕복이므로 메시지는 최대 6개다. */
export const CHAT_MAX_HISTORY_TURNS = 3;
export const CHAT_MAX_HISTORY_MESSAGES = CHAT_MAX_HISTORY_TURNS * 2;

/** 화면과 서버가 같은 문구를 쓰도록 고정한다. */
export const CHAT_GENERAL_HEADING = "AI 일반 설명";
export const CHAT_GENERAL_DISCLAIMER = "최신 확인 자료가 아닙니다";
export const CHAT_VERIFIED_HEADING = "확인된 자료";

/** 종목 검색어 상한. 질문 상한과 다른 값이다. */
export const CHAT_MAX_SEARCH_QUERY_LENGTH = 50;
/** 모호할 때 보여 줄 후보 수 상한. 자른 목록이라는 뜻이며 확정과 다르다. */
export const CHAT_MAX_CANDIDATES = 5;
/** 한 번에 보여 줄 공시 건수 범위. */
export const CHAT_MIN_FILINGS = 1;
export const CHAT_MAX_FILINGS = 5;

/** 여섯 자리 종목코드. 서버 전용 `isValidCode`와 같은 규칙을 브라우저에서도 쓰기 위한 순수 판정이다. */
export function isChatStockCode(value: unknown): value is string {
  return typeof value === "string" && /^\d{5}[\dA-Z]$/.test(value);
}

export type ChatTurnRole = "user" | "model";

export type ChatTurn = {
  role: ChatTurnRole;
  text: string;
};

/**
 * 후보 목록에서 고른 종목. 브라우저가 확인했다고 보내는 값이 아니라,
 * 서버가 같은 검색어로 다시 검색해 그 결과 안에 있는지 대조할 재료다.
 */
export type ChatSelectionInput = {
  searchQuery: string;
  code: string;
};

/**
 * 브라우저가 보내는 값 중 `routeCode`·`targetCode`·`selection`은 모두 힌트다.
 * 서버는 이 값을 사실로 받지 않고 실제 검색으로 다시 확인한다.
 */
export type ChatAskRequest = {
  question: string;
  history: ChatTurn[];
  /** 지금 보고 있는 상세 화면의 종목코드. 대화 대상의 최초 기본값일 뿐이다. */
  routeCode: string | null;
  /** 대화에서 이미 바뀐 현재 대화 대상. 있으면 `이 종목`은 이 값을 먼저 뜻한다. */
  targetCode: string | null;
  /** 후보를 고른 뒤 원래 질문을 이어 처리할 때만 채운다. */
  selection: ChatSelectionInput | null;
};

/** 화면에 보여 줄 AI 일반 설명 영역. 확인된 자료가 아니라는 표시를 항상 함께 보낸다. */
export type ChatGeneralRegion = {
  heading: typeof CHAT_GENERAL_HEADING;
  disclaimer: typeof CHAT_GENERAL_DISCLAIMER;
  summary: string;
  points: string[];
};

/** 필수 카드가 아닌 상태 메시지. 다음 행동은 2개 이내다. */
export type ChatStatusRegion = {
  message: string;
  nextActions: string[];
};

/** 서버가 실제 검색으로 확인한 한 종목. 브라우저가 보낸 값을 그대로 옮기지 않는다. */
export type ChatTarget = {
  code: string;
  name: string;
  market: string;
  corpName: string;
  /** 상장종목정보의 기준일. 가격 기준일과 다른 값이다. */
  baseDate: string;
};

/** 화면에 그릴 공시 한 건. 원문 URL은 서버가 접수번호로 만든다. */
export type ChatFilingItem = {
  receiptNo: string;
  receiptDate: string;
  reportName: string;
  filerName: string;
  documentUrl: string;
};

export type ChatFilingsEvidence = {
  from: string;
  to: string;
  /** 요청한 건수와 실제 보여 주는 건수를 구분한다. */
  requestedCount: number;
  shownCount: number;
  /** OpenDART가 알려 준 해당 기간 전체 건수. */
  totalCount: number;
  items: ChatFilingItem[];
};

/**
 * 서버가 확인한 최근 종가 하나. **기간이 없는 답이다.**
 *
 * 사용자가 기간을 말하지 않고 "최근 확인 종가와 기준일"을 물으면 이 모양으로 답한다.
 * 기간을 되묻지도, 요청하지 않은 기간 요약을 만들지도 않는다.
 */
export type ChatPriceLatestEvidence = {
  kind: "latest";
  /** 서비스가 쓰는 최근 확인 가격 기준일. 답변 준비 시각과 다른 값이다. */
  baseDate: string;
  /** 이 종가가 실제로 속한 거래일. 원본이 돌려준 날짜를 그대로 쓴다. */
  quoteDate: string;
  close: number;
  /**
   * 기준일에 거래일 자료가 없어 그보다 앞선 거래일의 종가라는 표시.
   * 왜 기준일이 중요한지(오늘 값이 아니라 확인된 마지막 거래일 값이라는 점)를 화면에서 밝힌다.
   */
  endsBeforeBaseDate: boolean;
};

/**
 * 서버가 확인한 가격 흐름 요약. 모든 수치는 실제 일봉에서 계산한 값이며 모델이 채우지 않는다.
 * 요청한 달력 구간(`requested*`)과 실제로 확인된 거래일 구간(`actual*`)을 항상 함께 담는다.
 * `actual`만 보여 주면 요청 구간과 같은 것으로 읽힌다.
 */
export type ChatPriceRangeEvidence = {
  kind: "range";
  /** 화면에 쓸 기간 이름. `1개월`·`3개월`·`12개월`처럼 달력 기준이다. */
  periodLabel: string;
  /** 최근 확인 가격 기준일. 답변 준비 시각과 다른 값이다. */
  baseDate: string;
  requestedFrom: string;
  requestedTo: string;
  actualFrom: string;
  actualTo: string;
  tradingDays: number;
  startClose: number;
  endClose: number;
  highestHigh: number;
  lowestLow: number;
  closeChange: number;
  /** % 단위. 시작·끝 종가와 함께 두어 계산 기준을 밝힌다. */
  closeChangeRate: number;
  /** 기준일 하루 시세에서 확인한 종가. 기준일 자료가 없으면 `null`. */
  baseDateClose: number | null;
  /** 요청 구간 앞부분에 확인된 자료가 없다. 전체 기간의 성과처럼 읽히지 않게 표시한다. */
  limitedBySource: boolean;
  /** 기준일에 거래일 자료가 없어 마지막 거래일이 요청 종료일보다 앞선다. */
  endsBeforeRequestedTo: boolean;
  /** 원본에서 실제로 확인된 제공 구간. */
  sourceFrom: string;
  sourceTo: string;
};

/**
 * 가격 근거는 두 모양 중 하나다. `kind`로 구분하며, 기간 요약을 요청하지 않은 답에
 * 기간 필드가 섞이지 않는다.
 */
export type ChatPriceEvidence = ChatPriceLatestEvidence | ChatPriceRangeEvidence;

/** 서버가 확인·계산한 값만 담는다. 모델 문장은 여기에 들어오지 않는다. */
export type ChatVerifiedRegion = {
  heading: typeof CHAT_VERIFIED_HEADING;
  target: ChatTarget | null;
  price: ChatPriceEvidence | null;
  filings: ChatFilingsEvidence | null;
  /** 아직 확인할 수 없는 항목을 서버 문구로 밝힌다. */
  notes: string[];
  /** 답변을 준비한 시각. 자료의 기준일과 다른 값이다. */
  preparedAt: string;
};

/** 대상이 모호해 멈춘 상태. 이 응답에서는 가격·공시 조회를 하지 않는다. */
export type ChatSelectionRegion = {
  message: string;
  /** 서버가 실제로 검색한 검색어. 선택 요청을 다시 대조할 때 같은 값을 쓴다. */
  searchQuery: string;
  candidates: ChatTarget[];
  /** 결과가 후보 수 상한보다 많아 잘렸는지. 잘린 것은 하나로 확정된 것과 다르다. */
  truncated: boolean;
  totalFound: number;
};

/**
 * 답변 본문은 두 영역(확인된 자료 / AI 일반 설명)과 선택적인 상태 메시지로 이루어진다.
 * 후보 선택이 필요하면 `selection`만 채우고 하위 조회는 하지 않는다.
 */
export type ChatAnswerPayload = {
  requestId: string;
  verified: ChatVerifiedRegion | null;
  general: ChatGeneralRegion | null;
  status: ChatStatusRegion | null;
  selection: ChatSelectionRegion | null;
  /** 서버가 이번 요청에서 확인한 현재 대화 대상. 확인하지 못했으면 null이다. */
  target: ChatTarget | null;
  /** 실제 수행한 내역만 사용자 언어로 담는다. 함수명·인자·호출 번호는 넣지 않는다. */
  steps: string[];
  model: string;
  generatedAt: string;
};

export class InvalidChatRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChatRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new InvalidChatRequestError(`${label}에 허용하지 않은 항목이 있습니다.`);
  }
}

function validateTurn(value: unknown, index: number): ChatTurn {
  if (!isRecord(value)) {
    throw new InvalidChatRequestError(`이전 대화 ${index + 1}번 형식이 올바르지 않습니다.`);
  }
  // 근거·출처·실행 결과를 브라우저가 만들어 보내도 사실로 받지 않는다.
  assertOnlyKeys(value, ["role", "text"], `이전 대화 ${index + 1}번`);
  if (value.role !== "user" && value.role !== "model") {
    throw new InvalidChatRequestError(`이전 대화 ${index + 1}번의 역할을 사용할 수 없습니다.`);
  }
  if (typeof value.text !== "string") {
    throw new InvalidChatRequestError(`이전 대화 ${index + 1}번 내용이 문자열이 아닙니다.`);
  }
  const text = value.text.trim();
  if (text.length === 0 || text.length > CHAT_MAX_QUESTION_LENGTH) {
    throw new InvalidChatRequestError(`이전 대화 ${index + 1}번 길이가 허용 범위를 넘었습니다.`);
  }
  return { role: value.role, text };
}

/** 상세 화면·현재 대화 대상 힌트는 종목코드 형식만 통과시킨다. 실제 종목인지는 서버가 다시 확인한다. */
function validateCodeHint(value: unknown, label: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isChatStockCode(value)) {
    throw new InvalidChatRequestError(`${label} 형식이 올바르지 않습니다.`);
  }
  return value;
}

function validateSelection(value: unknown): ChatSelectionInput | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!isRecord(value)) {
    throw new InvalidChatRequestError("선택한 종목 형식이 올바르지 않습니다.");
  }
  assertOnlyKeys(value, ["searchQuery", "code"], "선택한 종목");
  if (typeof value.searchQuery !== "string") {
    throw new InvalidChatRequestError("선택한 종목의 검색어 형식이 올바르지 않습니다.");
  }
  const searchQuery = value.searchQuery.trim();
  if (searchQuery.length === 0 || searchQuery.length > CHAT_MAX_SEARCH_QUERY_LENGTH) {
    throw new InvalidChatRequestError(
      `선택한 종목의 검색어는 ${CHAT_MAX_SEARCH_QUERY_LENGTH}자까지 보낼 수 있습니다.`
    );
  }
  if (!isChatStockCode(value.code)) {
    throw new InvalidChatRequestError("선택한 종목코드 형식이 올바르지 않습니다.");
  }
  return { searchQuery, code: value.code };
}

/** 모델을 호출하기 전에 요청을 검사한다. 통과하지 못하면 외부 호출을 하지 않는다. */
export function validateChatAskRequest(value: unknown): ChatAskRequest {
  if (!isRecord(value)) {
    throw new InvalidChatRequestError("요청 형식이 올바르지 않습니다.");
  }
  assertOnlyKeys(value, ["question", "history", "routeCode", "targetCode", "selection"], "요청");
  if (typeof value.question !== "string") {
    throw new InvalidChatRequestError("질문이 문자열이 아닙니다.");
  }
  const question = value.question.trim();
  if (question.length === 0) {
    throw new InvalidChatRequestError("질문을 입력해 주세요.");
  }
  if (question.length > CHAT_MAX_QUESTION_LENGTH) {
    throw new InvalidChatRequestError(
      `질문은 ${CHAT_MAX_QUESTION_LENGTH.toLocaleString("ko-KR")}자까지 보낼 수 있습니다.`
    );
  }
  if (value.history !== undefined && !Array.isArray(value.history)) {
    throw new InvalidChatRequestError("이전 대화 형식이 올바르지 않습니다.");
  }
  const history = (value.history ?? []) as unknown[];
  if (history.length > CHAT_MAX_HISTORY_MESSAGES) {
    throw new InvalidChatRequestError(`이전 대화는 최근 ${CHAT_MAX_HISTORY_TURNS}회 왕복까지만 보낼 수 있습니다.`);
  }
  return {
    question,
    history: history.map(validateTurn),
    routeCode: validateCodeHint(value.routeCode, "현재 화면 종목코드"),
    targetCode: validateCodeHint(value.targetCode, "현재 대화 대상 종목코드"),
    selection: validateSelection(value.selection),
  };
}

/** 기본으로 켜며, false를 명시한 경우에만 끈다. */
export function chatEnabledFrom(env: { CHAT_ENABLED?: string }): boolean {
  return env.CHAT_ENABLED?.trim() !== "false";
}

/**
 * 모바일 웹에서 대화 레이어를 실제로 보이는 영역(visual viewport)에 붙이기 위한 값.
 *
 * - `keyboardInset`: layout viewport 바닥에서 키보드 등이 가린 높이. 레이어를 이만큼 띄운다.
 * - `visualHeight`: 지금 실제로 보이는 높이. 레이어 높이를 이 값 안으로 제한한다.
 *
 * 브라우저 창 크기 시험(390×844)은 실기기의 키보드·안전 여백과 다르다. 이 함수는 계산만
 * 확인할 수 있고, 실제 앵커링은 기기에서 따로 확인해야 한다.
 */
export type ChatViewportMetrics = { keyboardInset: number; visualHeight: number };

export function chatViewportMetrics(input: {
  layoutHeight: number;
  visualHeight: number;
  offsetTop: number;
}): ChatViewportMetrics {
  const layoutHeight = Number.isFinite(input.layoutHeight) ? input.layoutHeight : 0;
  const visualHeight = Number.isFinite(input.visualHeight) ? Math.max(0, input.visualHeight) : 0;
  const offsetTop = Number.isFinite(input.offsetTop) ? Math.max(0, input.offsetTop) : 0;
  return {
    keyboardInset: Math.max(0, Math.round(layoutHeight - visualHeight - offsetTop)),
    visualHeight: Math.round(visualHeight),
  };
}

/**
 * 지우기·route 이동·대상 변경으로 generation이 올라가면 그 전 요청의 늦은 응답은 붙이지 않는다.
 * 이미 시작된 서버 호출을 되돌린다는 뜻은 아니다.
 */
export function shouldAcceptChatResponse(responseGeneration: number, currentGeneration: number): boolean {
  return responseGeneration === currentGeneration;
}
