import type {
  BriefingEvidencePacket,
  GroundedBriefing,
  GroundedBriefingItem,
} from "./types";
import { BRIEFING_FILING_RULE_TEXT } from "./filings";

export const BRIEFING_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: {
      type: "string",
      description: "근거 범위를 넘지 않는 짧은 한국어 제목. 숫자를 쓰지 않는다.",
    },
    highlights: {
      type: "array",
      minItems: 2,
      maxItems: 3,
      items: { $ref: "#/$defs/item" },
    },
    marketContext: { $ref: "#/$defs/items" },
    priceContext: { $ref: "#/$defs/items" },
    filingContext: { $ref: "#/$defs/items" },
    unknowns: { $ref: "#/$defs/items" },
  },
  required: ["headline", "highlights", "marketContext", "priceContext", "filingContext", "unknowns"],
  $defs: {
    item: {
      type: "object",
      additionalProperties: false,
      properties: {
        text: {
          type: "string",
          description: "인용한 Evidence의 날짜·숫자·공시명을 직접 사용해 쉽게 풀어쓴 한국어 한 문장.",
        },
        evidenceIds: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: { type: "string" },
        },
      },
      required: ["text", "evidenceIds"],
    },
    items: {
      type: "array",
      minItems: 1,
      maxItems: 3,
      items: { $ref: "#/$defs/item" },
    },
  },
} as const;

const FORBIDDEN_JUDGMENT =
  /매수|매도|투자\s*추천|추천\s*(?:종목|의견)|목표\s*주가|주가\s*예측|미래\s*(?:가격|주가)|상승할|하락할|오를\s*(?:것|가능성)|내릴\s*(?:것|가능성)|수익률\s*예측|투자\s*점수|저평가|고평가/;
const FORBIDDEN_CAUSALITY = /때문에|원인(?:이|으로)|영향으로|덕분에|초래했|야기했/;
const LOW_VALUE_META =
  /정보를 확인했|자료가 포함되어|기록을 계산하였|기록을 계산했|다양한 공시가 접수|가격·기준가 대비 등락·거래 자료가 있|일봉이 있|메타정보가 있/;
const NUMERIC_TOKEN = /(?:\d{4}\.\d{2}\.\d{2}|[+-]?\d[\d,]*(?:\.\d+)?%?)/g;
const EXPLICIT_BOUNDARY = /수 없|지 않|못하|어렵|불가|제한|근거가 없|뜻하지 않|포함하지 않/;

export class InvalidBriefingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBriefingError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numericTokens(text: string): string[] {
  return (text.match(NUMERIC_TOKEN) ?? []).map((token) =>
    token.replaceAll(",", "").replace(/^\+/, "")
  );
}

function validateText(text: unknown, label: string, numericEvidence = "", allowExplicitBoundary = false): string {
  if (typeof text !== "string" || text.trim().length < 2 || text.length > 240) {
    throw new InvalidBriefingError(`${label} 문장 형식이 올바르지 않습니다.`);
  }
  const allowedNumbers = new Set(numericTokens(numericEvidence));
  if (numericTokens(text).some((token) => !allowedNumbers.has(token))) {
    throw new InvalidBriefingError(`${label}에 인용한 근거에 없는 숫자가 있습니다.`);
  }
  const isExplicitBoundary = allowExplicitBoundary && EXPLICIT_BOUNDARY.test(text);
  if (FORBIDDEN_JUDGMENT.test(text) && !isExplicitBoundary) {
    throw new InvalidBriefingError(`${label}에 투자 판단·예측 표현이 있습니다.`);
  }
  if (FORBIDDEN_CAUSALITY.test(text) && !isExplicitBoundary) {
    throw new InvalidBriefingError(`${label}에 확인되지 않은 인과 표현이 있습니다.`);
  }
  if (LOW_VALUE_META.test(text)) {
    throw new InvalidBriefingError(`${label}가 근거의 존재만 되풀이합니다.`);
  }
  return text.trim();
}

function validateItems(
  value: unknown,
  label: string,
  allowedIds: Set<string>,
  numericEvidence: string,
  allowExplicitBoundary = false,
  minimumItems = 1
): GroundedBriefingItem[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > 3) {
    throw new InvalidBriefingError(`${label} 항목 수가 올바르지 않습니다.`);
  }
  return value.map((item, index) => {
    if (!isRecord(item) || !Array.isArray(item.evidenceIds)) {
      throw new InvalidBriefingError(`${label} ${index + 1}번 항목 형식이 올바르지 않습니다.`);
    }
    const evidenceIds = [...new Set(item.evidenceIds)];
    if (
      evidenceIds.length < 1 ||
      evidenceIds.length > 4 ||
      evidenceIds.some((id) => typeof id !== "string" || !allowedIds.has(id))
    ) {
      throw new InvalidBriefingError(`${label} ${index + 1}번 항목이 없는 근거를 인용했습니다.`);
    }
    return {
      text: validateText(item.text, `${label} ${index + 1}번`, numericEvidence, allowExplicitBoundary),
      evidenceIds: evidenceIds as string[],
    };
  });
}

/** 구조화 출력만으로 끝내지 않고 근거 ID·숫자·금지 판단을 서버에서 다시 검사한다. */
export function validateGroundedBriefing(value: unknown, packet: BriefingEvidencePacket): GroundedBriefing {
  if (!isRecord(value)) {
    throw new InvalidBriefingError("Gemini 응답이 객체가 아닙니다.");
  }
  const allowedIds = new Set([
    ...packet.observations.map((item) => item.id),
    "LIMITS",
  ]);
  const numericEvidence = packet.observations.map((item) => item.text).join("\n");
  return {
    headline: validateText(value.headline, "제목"),
    highlights: validateItems(value.highlights, "핵심 브리핑", allowedIds, numericEvidence, false, 2),
    marketContext: validateItems(value.marketContext, "시장 설명", allowedIds, numericEvidence),
    priceContext: validateItems(value.priceContext, "가격 설명", allowedIds, numericEvidence),
    filingContext: validateItems(value.filingContext, "공시 설명", allowedIds, numericEvidence),
    unknowns: validateItems(value.unknowns, "알 수 없는 것", allowedIds, numericEvidence, true),
  };
}

export function briefingPrompt(packet: BriefingEvidencePacket): string {
  const allowedEvidenceIds = [...packet.observations.map((item) => item.id), "LIMITS"];
  const filingHighlightInstruction = packet.filings.state === "ready" && packet.filings.representative.length > 0
    ? "핵심 브리핑의 마지막 문장은 최근 대표 공시 한 건 이상을 짚고, 공시와 가격 움직임의 인과관계를 현재 근거만으로 단정할 수 없다고 명시하세요. 공시 observation과 LIMITS를 함께 인용하세요."
    : "공시 근거가 없으면 핵심 브리핑에서 공시 내용을 만들지 말고, 현재 공시 근거가 없다는 경계를 적으세요.";
  return [
    "아래 EVIDENCE_PACKET만 읽고 주식을 잘 모르는 사람이 차트와 공시를 하나씩 읽지 않아도 핵심을 파악할 수 있는 짧은 한국어 브리핑을 작성하세요.",
    "인터넷 지식이나 학습된 회사 정보를 보태지 마세요. 도구를 사용하지 마세요.",
    "프로그램이 observations에 확정해 둔 날짜·가격·등락률·거래량·공시명은 그대로 복사해 사용하세요. 새 숫자를 계산하거나 반올림하거나 만들지 마세요.",
    "각 문장은 반드시 직접 뒷받침하는 observation id만 evidenceIds에 넣으세요. 숫자가 있는 문장은 그 숫자가 적힌 observation을 인용하세요.",
    `evidenceIds에는 다음 ID만 사용할 수 있습니다: ${JSON.stringify(allowedEvidenceIds)}`,
    "독자가 핵심 → 근거 → 회사 공시 → 현재 근거의 한계 순서로 이해할 수 있게 쓰세요.",
    "같은 문장을 highlights와 다른 영역에 그대로 반복하지 마세요. 각 세부 영역은 highlights에 없는 날짜·가격·공시 종류 같은 보충 근거를 중심으로 쓰세요.",
    "highlights는 핵심 브리핑입니다. MARKET_COMPARISON_LATEST와 MARKET_COMPARISON_PERIOD의 프로그램 계산 문장을 각각 한 문장으로 먼저 요약하세요. 배수를 새로 계산하지 말고 observation에 적힌 배수만 그대로 사용하세요.",
    filingHighlightInstruction,
    "시장과 종목 영역에서는 MARKET_COMPARISON_LATEST와 MARKET_COMPARISON_PERIOD를 사용해 종목과 해당 시장 지수의 상승률 또는 하락률 배수가 바로 보이게 쓰세요. 퍼센트포인트 차이로 바꾸지 마세요.",
    "가격 영역은 ① 기준일 종가와 전일 대비 등락률 ② 조회 기간의 시작 가격에서 최근 가격까지의 변화와 등락률 ③ 같은 기간 최고가와 최저가를 각각 짧은 문장으로 쓰세요. 절대 가격 차이, 거래량, 구간 내 위치처럼 중복되거나 요청하지 않은 숫자는 넣지 마세요.",
    `공시 전체 건수는 화면 제목에 프로그램 값으로 따로 표시합니다. 공시 영역에는 다음 기준으로 고른 대표 공시를 최대 3건까지 '8월 19일 — 공시명 · 공식 유형'처럼 날짜와 종류 중심으로 간결하게 쓰세요: ${BRIEFING_FILING_RULE_TEXT}`,
    "공시 제목은 공시검색 메타정보이지 본문 요약이 아닙니다. 제목보다 구체적인 발표 내용을 추측하지 말고 DART 원문 확인이 필요하다고 구분하세요.",
    "정보를 확인했습니다, 자료가 포함되어 있습니다, 기록을 계산하였습니다, 다양한 공시가 접수되었습니다처럼 Evidence가 존재한다는 사실만 되풀이하지 마세요.",
    "공시와 가격을 원인과 결과로 연결하지 마세요.",
    "매수·매도·추천·목표주가·미래 가격 예측·투자 점수를 만들지 마세요.",
    "시장·가격·공시 설명에서는 매수, 매도, 목표주가, 상승할, 하락할, 때문에, 원인으로, 영향으로라는 표현을 쓰지 마세요.",
    "unknowns에는 쉬운 말로 경계를 적으세요. '공시 메타정보만으로 공시 본문 전체의 의미를 확정할 수 없습니다' 대신 '공시 제목만으로 공시 내용 전체를 판단할 수 없습니다'라고 쓰세요. 가격 움직임의 이유, 미래 가격·목표주가·매수·매도 판단도 현재 근거로 알 수 없다고 반드시 부정형으로 적으세요.",
    "JSON Schema에 맞는 결과만 반환하세요.",
    `EVIDENCE_PACKET=${JSON.stringify(packet)}`,
  ].join("\n");
}

/** 실제 Gemini SDK에 넘길 요청을 순수 함수로 만들어 네트워크 없이 payload를 검사한다. */
export function buildBriefingRequest(packet: BriefingEvidencePacket) {
  return {
    contents: briefingPrompt(packet),
    config: {
      httpOptions: { timeout: 45_000, retryOptions: { attempts: 1 } },
      responseMimeType: "application/json",
      responseJsonSchema: BRIEFING_RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  } as const;
}
