import "server-only";
import { getGeminiApiKey } from "./server-env";
import { GEMINI_MODEL_ID } from "./gemini-config";
import type { BriefingFacts } from "./briefing-facts";
import { buildFactsBlock } from "./briefing-facts-block";

const GEMINI_ENDPOINT_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

// Gemini가 이 시간 안에 응답하지 않으면 중단한다 — 사용자를 계속 기다리게
// 하지 않고, AI 브리핑 영역에만 오류를 보여준다(호출하는 쪽에서 처리).
const GEMINI_REQUEST_TIMEOUT_MS = 20_000;

// 오류 메시지에 API 키 값이 그대로 들어가는 경우를 막는다. Gemini가 오류
// 응답에 요청 정보를 그대로 되돌려주는 경우는 알려져 있지 않지만, 화면에
// 보여주는 오류 문구에는 비밀값이 절대 남으면 안 되므로 방어적으로 지운다.
function redactSecret(text: string, secret: string): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}

// Gemini가 오류 응답에 담아 보내는 설명은 영어이고 요청 정보가 섞여 있을 수도
// 있다. 그 문구를 화면에 그대로 내보내면 사용자는 자기가 무엇을 해야 하는지
// 알 수 없다 -- 그래서 상태 코드만 보고 사람이 읽는 안내를 만든다. 안내에는
// 다음에 할 일(키를 확인한다 / 잠시 뒤 다시 누른다)이 반드시 들어간다.
function userFacingHttpErrorMessage(status: number): string {
  if (status === 400 || status === 401 || status === 403) {
    return "Gemini 인증에 실패했습니다. API Key가 올바르게 설정됐는지 확인해 주세요.";
  }
  if (status === 404) {
    return "설정된 Gemini 모델을 사용할 수 없습니다. 모델 이름을 확인해 주세요.";
  }
  if (status === 429) {
    return "Gemini 호출 한도에 도달했습니다. 잠시 뒤 다시 눌러 주세요.";
  }
  return "Gemini 호출에 실패했습니다. 잠시 뒤 다시 눌러 주세요.";
}

export class GeminiRateLimitError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(retryAfterSeconds: number | null) {
    super("Gemini 사용량 한도(HTTP 429)에 도달했습니다. 잠시 뒤 다시 눌러 주세요.");
    this.name = "GeminiRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function extractRetryAfterSeconds(res: Response, json: unknown): number | null {
  const headerValue = res.headers?.get("retry-after") ?? null;
  if (headerValue) {
    const asSeconds = Number(headerValue);
    if (Number.isFinite(asSeconds)) return asSeconds;
    const asDate = Date.parse(headerValue);
    if (!Number.isNaN(asDate)) return Math.max(0, Math.round((asDate - Date.now()) / 1000));
  }
  const details = (json as { error?: { details?: unknown[] } }).error?.details;
  if (Array.isArray(details)) for (const detail of details) {
    const retryDelay = (detail as { retryDelay?: unknown }).retryDelay;
    if (typeof retryDelay === "string") {
      const match = /^([\d.]+)s$/.exec(retryDelay.trim());
      if (match) return Number(match[1]);
    }
  }
  return null;
}

// 여기서 만드는 프롬프트에는 briefing-facts.ts가 이미 계산해 둔 값만 넣는다
// — 화면에 "프로그램이 확인한 사실"로 보여주는 값과 같은 값이다. Gemini는
// 이 값들을 바탕으로 짧은 "핵심 브리핑" 한 단락만 쓰고, 새 숫자나 사실을
// 계산하거나 지어내지 않는다.
export interface EvidencePacket {
  generatedAt: string;
  observations: Array<{ id: string; text: string; sourceIds: string[] }>;
  references: Array<{ id: string; label: string; url: string }>;
  limits: string[];
}
export interface GroundedBriefingItem { text: string; evidenceIds: string[] }

export interface StructuredBriefing {
  headline: string;
  highlights: GroundedBriefingItem[];
  marketContext: GroundedBriefingItem[];
  priceContext: GroundedBriefingItem[];
  filingContext: GroundedBriefingItem[];
  unknowns: GroundedBriefingItem[];
}

const ITEM_SCHEMA = {
  type: "OBJECT", additionalProperties: false,
  properties: { text: { type: "STRING" }, evidenceIds: { type: "ARRAY", minItems: 1, maxItems: 4, items: { type: "STRING" } } },
  required: ["text", "evidenceIds"],
};
const ITEM_ARRAY_SCHEMA = {
  type: "ARRAY",
  minItems: 1, maxItems: 3, items: ITEM_SCHEMA,
};

const BRIEFING_RESPONSE_SCHEMA = {
  type: "OBJECT", additionalProperties: false,
  properties: {
    headline: { type: "STRING" },
    highlights: { ...ITEM_ARRAY_SCHEMA, minItems: 2 },
    marketContext: ITEM_ARRAY_SCHEMA,
    priceContext: ITEM_ARRAY_SCHEMA,
    filingContext: ITEM_ARRAY_SCHEMA,
    unknowns: ITEM_ARRAY_SCHEMA,
  },
  required: ["headline", "highlights", "marketContext", "priceContext", "filingContext", "unknowns"],
};

export function buildEvidencePacket(facts: BriefingFacts): EvidencePacket {
  const observations = [
    ...facts.marketComparison.map((item, index) => ({ id: `MARKET_${index + 1}`, text: `${item.indexName} 등락률 ${item.indexChangeRate}%와 ${facts.stock.name} 등락률 ${item.stockChangeRate}%의 차이는 ${item.deltaPp}%p이며 ${item.magnitude}이다. 기준일 ${item.indexBaseDate}.`, sourceIds: ["FSC_INDEX", "FSC_STOCK"] })),
    { id: "STOCK_QUOTE", text: `${facts.stock.baseDate} ${facts.stock.name} 종가는 ${facts.stock.price}원, 등락률은 ${facts.stock.changeRate}%이다.`, sourceIds: ["FSC_STOCK"] },
    { id: "PRICE_PERIOD", text: `${facts.priceFlow.periodStartDate} ${facts.priceFlow.periodStartPrice}원부터 ${facts.priceFlow.periodEndDate} ${facts.priceFlow.periodEndPrice}원까지 변동률은 ${facts.priceFlow.periodChangeRate}%이고 거래일은 ${facts.priceFlow.tradingDayCount}일이다.`, sourceIds: ["FSC_STOCK"] },
    { id: "PRICE_RANGE", text: `기간 최고가는 ${facts.priceFlow.yearHigh?.price ?? "계산 불가"}원, 최저가는 ${facts.priceFlow.yearLow?.price ?? "계산 불가"}원이다.`, sourceIds: ["FSC_STOCK"] },
    { id: "FILING_PERIOD", text: `${facts.disclosures.beginDate}부터 ${facts.disclosures.endDate}까지 OpenDART 공시 ${facts.disclosures.totalCount}건이다.`, sourceIds: ["OPEN_DART"] },
    ...(facts.disclosures.representative ?? []).map((item) => ({ id: `FILING_${item.receiptNo}`, text: `${item.receiptDate} — ${item.reportName} · ${item.disclosureTypeLabel}. 제출인 ${item.submitter}.`, sourceIds: ["OPEN_DART"] })),
  ];
  return { generatedAt: new Date().toISOString(), observations, references: [
    { id: "FSC_STOCK", label: "금융위원회 주식시세정보", url: "https://www.data.go.kr/data/15094808/openapi.do" },
    { id: "FSC_INDEX", label: "금융위원회 지수시세정보", url: "https://www.data.go.kr/data/15094809/openapi.do" },
    { id: "OPEN_DART", label: "OpenDART 공시검색", url: "https://opendart.fss.or.kr/" },
  ], limits: facts.unknownCaveats };
}

export function buildPrompt(packet: EvidencePacket): string {
  return `아래 EVIDENCE_PACKET만 근거로 한국어 브리핑을 작성하라.

[준수 사항]
- 아래 제공된 데이터 외의 사실을 추가하지 말 것. 인터넷 검색이나 사전 지식으로 보완하지 말 것.
- 이 회사나 산업에 대해 네가 이미 알고 있는 지식(연혁, 사업 내용, 평판, 과거 뉴스, 실적 등)을 쓰지 말 것. 여기 제공되지 않은 사실은 모른다고 취급할 것.
- 숫자를 새로 계산하거나 반올림을 다시 하지 말 것. 등락률·변동률·차이(%p)는 이미 프로그램이 계산해 둔 값이니 그 값을 그대로 옮겨 쓸 것.
- 시장 대비 비교를 말할 때는 아래에 이미 계산된 차이(%p)와 "훨씬 큰 폭"/"큰 폭"/"약간"/"비슷한 수준" 표현을 그대로 활용해서, 숫자만 나열하지 말고 이해하기 쉽게 풀어서 설명할 것.
- 사실을 말할 때는 그 사실의 기준 날짜를 함께 밝힐 것.
- 공시 목록과 주가 변동 사이의 인과관계를 단정하지 말 것. 같은 기간에 있었던 사실로만 나열할 것. 아래 "이 자료로 알 수 없는 것" 목록에 있는 내용은 안다고 쓰지 말 것.
- 미래 가격을 예측하거나 전망하지 말 것. 목표주가를 계산하거나 언급하지 말 것. 매수·매도 판단이나 투자 조언을 하지 말 것. 사실 요약만 할 것.
- 공시는 제목과 제출인만 제공된 것이다. 제목만으로 공시 내용 전체를 판단하거나 추측해서 설명하지 말 것 — 제목을 그대로 옮기고, 자세한 내용이 필요하면 DART 원문을 봐야 한다고 안내할 것.
- headline은 전체를 한 문장으로 요약할 것.
- highlights에는 가장 중요한 사실 2~3개를 넣을 것.
- marketContext, priceContext, filingContext에는 각각 해당 근거를 1~3개 넣을 것.
- unknowns에는 아래 "이 자료로 알 수 없는 것"만 옮길 것.
- 모든 배열 항목은 {"text":"...","evidenceIds":["직접 근거 ID"]} 형태로 작성할 것. observations의 ID와 LIMITS만 사용할 것.

EVIDENCE_PACKET=${JSON.stringify(packet)}`;
}

async function callGemini(
  apiKey: string,
  prompt: string,
  generationConfig: Record<string, unknown>
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_REQUEST_TIMEOUT_MS);

  let res: Response;
  let rawText: string;
  try {
    res = await fetch(`${GEMINI_ENDPOINT_BASE}/${GEMINI_MODEL_ID}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      // tools(googleSearch 등)를 넣지 않는다 — Gemini는 이 필드가 명시된
      // 요청에서만 인터넷 검색으로 답을 보완한다. 여기서는 절대 넣지 않는다.
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: controller.signal,
    });
    rawText = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `Gemini 응답이 ${GEMINI_REQUEST_TIMEOUT_MS / 1000}초 안에 오지 않아 기다리지 않고 중단했습니다.`
      );
    }
    throw new Error("Gemini를 호출하는 중 네트워크 오류가 발생했습니다.");
  } finally {
    clearTimeout(timer);
  }

  // 이 시점부터는 응답 본문에 API 키가 그대로 들어 있을 가능성은 거의
  // 없지만, 화면에 보여줄 오류 문구를 만들기 전에 한 번 더 지운다.
  const text = redactSecret(rawText, apiKey);

  if (!res.ok && res.status !== 429) throw new Error(userFacingHttpErrorMessage(res.status));

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Gemini 응답을 해석할 수 없습니다 (HTTP ${res.status}).`);
  }

  if (!res.ok) throw new GeminiRateLimitError(extractRetryAfterSeconds(res, json));

  const candidates = (
    json as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    }
  ).candidates;
  const responseText =
    candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!responseText) {
    throw new Error("Gemini가 응답 내용을 돌려주지 않았습니다.");
  }
  return responseText;
}

const FORBIDDEN = /매수|매도|투자\s*추천|목표\s*주가|상승할|하락할|오를\s*(?:것|가능성)|내릴\s*(?:것|가능성)|저평가|고평가/;
const CAUSAL = /때문에|원인(?:이|으로)|영향으로|덕분에|초래했|야기했/;
const NUMERIC = /(?:\d{4}[.-]\d{2}[.-]\d{2}|[+-]?\d[\d,]*(?:\.\d+)?%?)/g;
function tokens(text: string) { return (text.match(NUMERIC) ?? []).map((v) => v.replaceAll(",", "").replace(/^\+/, "")); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validateItems(value: unknown, label: string, allowed: Set<string>, evidence: Map<string,string>, min=1): GroundedBriefingItem[] {
  if (!Array.isArray(value) || value.length < min || value.length > 3) throw new Error(`${label} 항목 수가 올바르지 않습니다.`);
  return value.map((raw, index) => {
    if (!isRecord(raw) || Object.keys(raw).some((key) => !["text","evidenceIds"].includes(key)) || typeof raw.text !== "string" || raw.text.trim().length < 2 || raw.text.length > 240 || !Array.isArray(raw.evidenceIds)) throw new Error(`${label} ${index+1} 형식이 올바르지 않습니다.`);
    if (raw.evidenceIds.length < 1 || raw.evidenceIds.length > 4) throw new Error(`${label} ${index+1} 근거가 올바르지 않습니다.`);
    const ids = [...new Set(raw.evidenceIds)];
    if (ids.some((id) => typeof id !== "string" || !allowed.has(id))) throw new Error(`${label} ${index+1} 근거가 올바르지 않습니다.`);
    const numericEvidence = ids.map((id) => evidence.get(String(id)) ?? "").join("\n");
    const allowedNumbers = new Set(tokens(numericEvidence));
    if (tokens(raw.text).some((token) => !allowedNumbers.has(token))) throw new Error(`${label} ${index+1}에 근거 없는 숫자가 있습니다.`);
    const boundary = label === "알 수 없는 것" && /수 없|않|못|불가|제한/.test(raw.text);
    if (!boundary && (FORBIDDEN.test(raw.text) || CAUSAL.test(raw.text))) throw new Error(`${label} ${index+1}에 금지 표현이 있습니다.`);
    return { text: raw.text.trim(), evidenceIds: ids as string[] };
  });
}
function parseStructuredBriefing(raw: string, packet: EvidencePacket): StructuredBriefing {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Gemini 브리핑 결과를 해석할 수 없습니다."); }
  const fields = ["highlights","marketContext","priceContext","filingContext","unknowns"] as const;
  if (!isRecord(parsed) || Object.keys(parsed).some((key) => !["headline",...fields].includes(key as never)) || fields.some((key) => !Array.isArray(parsed[key])) || typeof parsed.headline !== "string" || parsed.headline.trim().length < 2 || parsed.headline.length > 120 || tokens(parsed.headline).length || FORBIDDEN.test(parsed.headline) || CAUSAL.test(parsed.headline)) throw new Error("Gemini 브리핑 결과 형식이 예상과 다릅니다.");
  const evidence = new Map(packet.observations.map((item) => [item.id, item.text])); evidence.set("LIMITS", packet.limits.join("\n"));
  const allowed = new Set([...evidence.keys()]);
  return { headline: parsed.headline.trim(), highlights: validateItems(parsed.highlights,"핵심 브리핑",allowed,evidence,2), marketContext: validateItems(parsed.marketContext,"시장 설명",allowed,evidence), priceContext: validateItems(parsed.priceContext,"가격 설명",allowed,evidence), filingContext: validateItems(parsed.filingContext,"공시 설명",allowed,evidence), unknowns: validateItems(parsed.unknowns,"알 수 없는 것",allowed,evidence) };
}

export function briefingText(briefing: StructuredBriefing): string {
  return [briefing.headline, ...briefing.highlights, ...briefing.marketContext,
    ...briefing.priceContext, ...briefing.filingContext, ...briefing.unknowns]
    .map((item) => typeof item === "string" ? item : item.text).join("\n");
}

export function isRetryableGeminiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return !/인증에 실패|API Key|모델을 사용할 수 없|모델 이름/.test(message);
}

export async function generateStockBriefing(input: EvidencePacket | BriefingFacts): Promise<StructuredBriefing> {
  const packet = "observations" in input ? input : buildEvidencePacket(input);
  const apiKey = getGeminiApiKey();
  const prompt = buildPrompt(packet);
  const raw = await callGemini(apiKey, prompt, {
    temperature: 0.2,
    responseMimeType: "application/json",
    responseSchema: BRIEFING_RESPONSE_SCHEMA,
  });
  return parseStructuredBriefing(raw, packet);
}

export interface BriefingVerdict {
  hasUnprovidedFacts: boolean;
  hasInvestmentRecommendation: boolean;
  hasTargetPrice: boolean;
  hasFuturePrediction: boolean;
  hasUnverifiedCausalClaim: boolean;
  reason: string;
}

const VERIFICATION_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    hasUnprovidedFacts: { type: "BOOLEAN" },
    hasInvestmentRecommendation: { type: "BOOLEAN" },
    hasTargetPrice: { type: "BOOLEAN" },
    hasFuturePrediction: { type: "BOOLEAN" },
    hasUnverifiedCausalClaim: { type: "BOOLEAN" },
    reason: { type: "STRING" },
  },
  required: [
    "hasUnprovidedFacts",
    "hasInvestmentRecommendation",
    "hasTargetPrice",
    "hasFuturePrediction",
    "hasUnverifiedCausalClaim",
    "reason",
  ],
};

// 생성된 문단을 화면에 바로 보여주지 않고, 같은 사실 블록을 다시 주고
// 규칙을 어겼는지만 판정하게 한다. 문장이 매번 똑같은지는 보지 않는다 —
// 아래 5가지 규칙을 어겼는지만 본다.
function buildVerificationPrompt(facts: BriefingFacts, candidateText: string): string {
  return `너는 아래 "검사할 문단"이 규칙을 어겼는지만 판정하는 검증자다. 문장 표현, 어순, 문체는 신경 쓰지 마라 — 오직 아래 5개 규칙 위반 여부만 판정한다.

[검사할 문단]
${candidateText}

[이 문단이 근거로 삼을 수 있는 사실 전체]
${buildFactsBlock(facts)}

[규칙 — 각각 true/false로 답하라]
1. hasUnprovidedFacts: 위 "근거로 삼을 수 있는 사실"에 없는 숫자나 사실(회사 연혁, 사업 내용, 실적, 외부 평가, 뉴스 등)을 새로 담고 있으면 true.
2. hasInvestmentRecommendation: 매수·매도·보유 등 투자 행동을 권하거나 암시하면 true.
3. hasTargetPrice: 목표주가·적정가 등 특정 미래 가격 수치나 범위를 제시하면 true.
4. hasFuturePrediction: 앞으로의 가격이나 실적 방향을 예측·전망하면 true.
5. hasUnverifiedCausalClaim: 공시나 다른 사건이 주가 변동의 원인이라고 근거 없이 단정하면 true. ("같은 기간에 있었다"거나 날짜를 나열하는 것은 인과관계 단정이 아니므로 false.)

reason에는 true인 항목이 있으면 그 이유를 한국어 한두 문장으로 쓰고, 전부 false면 "문제 없음"이라고 써라.`;
}

export async function verifyStockBriefing(
  facts: BriefingFacts,
  candidateText: string
): Promise<BriefingVerdict> {
  const apiKey = getGeminiApiKey();
  const prompt = buildVerificationPrompt(facts, candidateText);
  const raw = await callGemini(apiKey, prompt, {
    temperature: 0,
    responseMimeType: "application/json",
    responseSchema: VERIFICATION_RESPONSE_SCHEMA,
  });

  let verdict: unknown;
  try {
    verdict = JSON.parse(raw);
  } catch {
    throw new Error("Gemini 검증 결과를 해석할 수 없습니다.");
  }
  const v = verdict as Partial<BriefingVerdict>;
  if (
    typeof v.hasUnprovidedFacts !== "boolean" ||
    typeof v.hasInvestmentRecommendation !== "boolean" ||
    typeof v.hasTargetPrice !== "boolean" ||
    typeof v.hasFuturePrediction !== "boolean" ||
    typeof v.hasUnverifiedCausalClaim !== "boolean"
  ) {
    throw new Error("Gemini 검증 결과 형식이 예상과 다릅니다.");
  }
  return {
    hasUnprovidedFacts: v.hasUnprovidedFacts,
    hasInvestmentRecommendation: v.hasInvestmentRecommendation,
    hasTargetPrice: v.hasTargetPrice,
    hasFuturePrediction: v.hasFuturePrediction,
    hasUnverifiedCausalClaim: v.hasUnverifiedCausalClaim,
    reason: typeof v.reason === "string" ? v.reason : "",
  };
}
