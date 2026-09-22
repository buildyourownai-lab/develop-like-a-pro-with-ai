import assert from "node:assert/strict";
import test from "node:test";

import { movementRateRatio, summarizeMarketComparison, summarizePriceHistory } from "../../src/lib/briefing-facts";
import {
  briefingPrompt,
  buildBriefingRequest,
  InvalidBriefingError,
  validateGroundedBriefing,
} from "../../src/lib/briefing";
import type { BriefingEvidencePacket, DailyBar } from "../../src/lib/types";

const bar = (date: string, close: number, high: number, low: number): DailyBar => ({
  date,
  open: close,
  high,
  low,
  close,
  volume: 100,
  tradeValue: 1_000,
});

const packet = {
  schemaVersion: "2.0",
  generatedAt: "2026-08-20T00:00:00.000Z",
  market: { priceBaseDate: "20260818", indexBaseDate: "20260818", indices: [], gainers: [], losers: [] },
  stock: {
    code: "000660", name: "표본회사", market: "KOSPI", quoteBaseDate: "20260818", close: 120,
    basePrice: 110, diff: 10, changeRate: 9.09, open: 115, high: 125, low: 114, volume: 100, tradeValue: 12_000,
  },
  priceHistory: {
    from: "20260817", to: "20260818", tradingDays: 2, startClose: 100, endClose: 120,
    highestHigh: 125, lowestLow: 90, closeChange: 20, closeChangeRate: 20,
    rangePositionRate: 85.71428571428571, isShortHistory: true,
  },
  marketComparison: {
    indexName: "코스피", from: "20260817", to: "20260818", indexStartClose: 1000,
    indexEndClose: 1100, stockChangeRate: 20, indexChangeRate: 10, relativeChangeRate: 10,
    changeRateRatio: 2,
    latestStockChangeRate: 9.09, latestIndexChangeRate: 1, latestRelativeChangeRate: 8.09,
    latestChangeRateRatio: 9.1,
  },
  filings: {
    state: "ready", corpName: "표본회사", from: "20260817", to: "20260820", totalCount: 1,
    typeCounts: [{ code: "A", label: "정기공시", count: 1 }],
    representative: [{
      receiptNo: "20260818000001", receiptDate: "20260818", reportName: "반기보고서 (2026.06)",
      filerName: "표본회사", noteLabels: [], documentUrl: "https://dart.fss.or.kr/example",
      disclosureTypeCode: "A", disclosureTypeLabel: "정기공시", selectionReason: "정기공시 중 접수일 최신순",
    }],
  },
  observations: [
    { id: "MARKET_SNAPSHOT", text: "코스피는 1,500.00이고 등락률은 -5.80%다.", sourceIds: ["FSC_INDEX"] },
    { id: "PRICE_RANGE", text: "최고가는 125원, 최저가는 90원이다.", sourceIds: ["FSC_STOCK"] },
    { id: "MARKET_COMPARISON_LATEST", text: "2026.08.18 표본회사는 9.09% 상승해, 코스피 상승률 1.00%보다 약 9.1배 큰 폭으로 올랐습니다.", sourceIds: ["FSC_STOCK", "FSC_INDEX"] },
    { id: "MARKET_COMPARISON_PERIOD", text: "최근 1년간 표본회사는 20.00% 상승해, 상승률이 코스피(10.00%)의 약 2.0배였습니다.", sourceIds: ["FSC_STOCK", "FSC_INDEX"] },
    { id: "FILING_PERIOD", text: "2026.08.17부터 2026.08.20까지 OpenDART 공시 1건이 접수됐다.", sourceIds: ["OPEN_DART"] },
    { id: "FILING_20260818000001", text: "2026.08.18 정기공시 「반기보고서 (2026.06)」가 접수됐다.", sourceIds: ["OPEN_DART"] },
  ],
  references: [{ id: "FSC_STOCK", label: "공식 시세", provider: "공공데이터포털", url: "https://example.test" }],
  limits: ["인과관계와 미래 가격은 알 수 없다."],
} satisfies BriefingEvidencePacket;

const valid = {
  headline: "확인된 근거를 함께 봅니다",
  highlights: [
    { text: "표본회사는 9.09% 상승해 코스피보다 약 9.1배 큰 폭으로 올랐습니다.", evidenceIds: ["MARKET_COMPARISON_LATEST"] },
    { text: "최근 1년간 상승률은 코스피의 약 2.0배였습니다.", evidenceIds: ["MARKET_COMPARISON_PERIOD"] },
  ],
  marketContext: [{ text: "공식 시장 자료와 함께 살펴봅니다.", evidenceIds: ["MARKET_SNAPSHOT"] }],
  priceContext: [{ text: "최고가는 125원, 최저가는 90원입니다.", evidenceIds: ["PRICE_RANGE"] }],
  filingContext: [{ text: "2026.08.18 정기공시 「반기보고서 (2026.06)」가 접수됐습니다.", evidenceIds: ["FILING_20260818000001"] }],
  unknowns: [{ text: "움직임의 이유와 미래 흐름은 이 근거로 알 수 없습니다.", evidenceIds: ["LIMITS"] }],
};

test("가격 구간의 시작·끝·최고·최저·거래일을 프로그램이 직접 계산한다", () => {
  const summary = summarizePriceHistory([
    bar("20260817", 100, 110, 90),
    bar("20260818", 120, 125, 105),
  ]);
  assert.deepEqual(summary, packet.priceHistory);
  assert.throws(() => summarizePriceHistory([]), /거래일 자료/);
});

test("허용된 근거 ID만 가진 구조화 브리핑을 통과시킨다", () => {
  assert.deepEqual(validateGroundedBriefing(valid, packet), valid);
});

test("없는 근거, AI 숫자 재계산, 투자 판단과 인과 단정을 거부한다", () => {
  const change = (section: keyof typeof valid, text: string, evidenceIds = ["PRICE_RANGE"]) => ({
    ...valid,
    [section]: [{ text, evidenceIds }],
  });
  assert.throws(() => validateGroundedBriefing(change("priceContext", "최근 7년 동안 올랐습니다."), packet), InvalidBriefingError);
  assert.throws(() => validateGroundedBriefing(change("priceContext", "매수하기 좋은 종목입니다."), packet), /투자 판단/);
  assert.throws(() => validateGroundedBriefing(change("filingContext", "공시 때문에 가격이 움직였습니다."), packet), /인과 표현/);
  assert.throws(() => validateGroundedBriefing(change("priceContext", "가격 범위를 살펴봅니다.", ["MADE_UP"]), packet), /없는 근거/);
  const safeBoundary = {
    ...valid,
    unknowns: [
      { text: "현재 근거만으로 미래 가격이나 매수·매도 결정을 판단할 수 없습니다.", evidenceIds: ["LIMITS"] },
      { text: "현재 근거만으로 미래 가격을 예측할 수 없습니다.", evidenceIds: ["LIMITS"] },
      { text: "미래 전망이나 매수·매도 권고는 할 수 없습니다.", evidenceIds: ["LIMITS"] },
    ],
  };
  assert.deepEqual(validateGroundedBriefing(safeBoundary, packet), safeBoundary);
  const unsafeBoundary = {
    ...valid,
    unknowns: [{ text: "미래 가격을 예측하고 매수를 추천합니다.", evidenceIds: ["LIMITS"] }],
  };
  assert.throws(() => validateGroundedBriefing(unsafeBoundary, packet), /투자 판단/);
});

test("인용한 Evidence의 숫자만 허용하고 근거 존재만 반복하는 문장을 거부한다", () => {
  assert.deepEqual(validateGroundedBriefing(valid, packet), valid);
  const normalized = {
    ...valid,
    marketContext: [{ text: "코스피는 1500.00이고 등락률은 -5.80%입니다.", evidenceIds: ["MARKET_SNAPSHOT"] }],
    priceContext: [{ text: "종목은 20.00% 변했고 최고가는 125원입니다.", evidenceIds: ["PRICE_RANGE", "MARKET_COMPARISON_PERIOD"] }],
  };
  assert.deepEqual(validateGroundedBriefing(normalized, packet), normalized);
  const wrongSign = {
    ...valid,
    marketContext: [{ text: "코스피 등락률은 5.80%입니다.", evidenceIds: ["MARKET_SNAPSHOT"] }],
  };
  assert.throws(() => validateGroundedBriefing(wrongSign, packet), /근거에 없는 숫자/);
  const invented = { ...valid, priceContext: [{ text: "최고가는 130원입니다.", evidenceIds: ["PRICE_RANGE"] }] };
  assert.throws(() => validateGroundedBriefing(invented, packet), /근거에 없는 숫자/);
  const rawSourceId = { ...valid, marketContext: [{ text: "공식 시장 자료입니다.", evidenceIds: ["FSC_STOCK"] }] };
  assert.throws(() => validateGroundedBriefing(rawSourceId, packet), /없는 근거/);
  const vague = { ...valid, priceContext: [{ text: "가격 기록을 계산하였습니다.", evidenceIds: ["PRICE_RANGE"] }] };
  assert.throws(() => validateGroundedBriefing(vague, packet), /존재만 되풀이/);
});

test("종목과 같은 기간·날짜의 시장 지수 변화를 프로그램이 비교한다", () => {
  const comparison = summarizeMarketComparison(packet.stock, packet.priceHistory, [
    { baseDate: "20260817", name: "코스피", close: 1000, diff: 0, changeRate: 0, open: 1000, high: 1000, low: 1000, tradeValue: 0 },
    { baseDate: "20260818", name: "코스피", close: 1100, diff: 10, changeRate: 1, open: 1090, high: 1110, low: 1080, tradeValue: 0 },
  ]);
  assert.equal(comparison?.indexChangeRate, 10);
  assert.equal(comparison?.relativeChangeRate, 10);
  assert.equal(comparison?.changeRateRatio, 2);
  assert.equal(comparison?.latestRelativeChangeRate, 8.09);
  assert.equal(comparison?.latestChangeRateRatio, 9.1);
  assert.equal(movementRateRatio(-9.75, -5.8), 1.7);
  assert.equal(movementRateRatio(9.75, -5.8), null);
  assert.equal(movementRateRatio(9.75, 0), null);
});

test("프롬프트가 구체적인 값·대표 공시를 요구하고 추상적인 메타 설명을 금지한다", () => {
  const prompt = briefingPrompt(packet);
  assert.match(prompt, /시작 가격에서 최근 가격/);
  assert.match(prompt, /주요사항보고 2건/);
  assert.match(prompt, /핵심 브리핑/);
  assert.match(prompt, /퍼센트포인트 차이로 바꾸지 마세요/);
  assert.match(prompt, /공시 제목만으로 공시 내용 전체를 판단할 수 없습니다/);
  assert.match(prompt, /자료가 포함되어 있습니다/);
  assert.doesNotMatch(prompt, /어떤 필드에도 숫자를 쓰지 마세요/);
});

test("실제 Gemini 요청 payload에 프로그램 확정값이 JSON으로 들어간다", () => {
  const request = buildBriefingRequest(packet);
  assert.match(request.contents, /"name":"표본회사"/);
  assert.match(request.contents, /"startClose":100/);
  assert.match(request.contents, /evidenceIds에는 다음 ID만/);
  assert.match(request.contents, /MARKET_SNAPSHOT/);
  assert.doesNotMatch(request.contents.match(/evidenceIds에는 다음 ID만[^\n]*/)?.[0] ?? "", /FSC_STOCK/);
  assert.match(request.contents, /"highestHigh":125/);
  assert.match(request.contents, /"volume":100/);
  assert.match(request.contents, /"relativeChangeRate":10/);
  assert.match(request.contents, /"changeRateRatio":2/);
  assert.match(request.contents, /반기보고서 \(2026\.06\)/);
  assert.equal(request.config.responseMimeType, "application/json");
  assert.equal(request.config.temperature, 0.2);
});
