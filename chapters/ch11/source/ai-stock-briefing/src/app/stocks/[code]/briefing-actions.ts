"use server";

import { getStockHistorySnapshot } from "@/lib/stock-price-api";
import { getLatestIndexQuote } from "@/lib/market-index-api";
import { DISCLOSURE_TYPES, getDisclosurePageByStockCode, getDisclosureTypeCounts, getRecentDisclosuresByStockCode, type DisclosureTypeCode } from "@/lib/dart-disclosure-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "@/lib/trading-date";
import { formatBaseDateLabel } from "@/lib/format";
import {
  buildMarketComparison,
  buildPriceFlow,
  buildUnknownCaveats,
  type BriefingFacts,
} from "@/lib/briefing-facts";
import { buildEvidencePacket, briefingText, generateStockBriefing, isRetryableGeminiError, verifyStockBriefing, type EvidencePacket, type StructuredBriefing } from "@/lib/gemini-briefing-api";
import { GEMINI_MODEL_ID } from "@/lib/gemini-config";
import { findUnknownNumbersFromEvidence } from "@/lib/briefing-verify";

export type BriefingActionResult =
  | { facts: BriefingFacts; packet: EvidencePacket; briefing: StructuredBriefing; model: string; generatedAt: string }
  | { facts: BriefingFacts; packet: EvidencePacket; aiError: string; retryable: boolean }
  | { error: string; retryable: boolean };

// 클라이언트는 종목코드만 넘긴다. 시세·지수·차트·공시는 여기서 금융위원회·
// OpenDART API로 다시 조회해 쓴다 — 클라이언트가 보낸 값을 그대로 믿고
// Gemini에 넘기지 않는다.
export async function generateStockBriefingAction(
  code: string
): Promise<BriefingActionResult> {
  const snapshot = await getStockHistorySnapshot(code);
  if (!snapshot) {
    return { error: "종목 시세를 찾지 못해 브리핑을 만들 수 없습니다.", retryable: false };
  }

  const endDate = formatYyyyMmDd(new Date());
  const beginDate = subtractDaysYyyyMmDd(endDate, 365);

  const representativeTypes: DisclosureTypeCode[] = ["A", "B", "I"];
  const [kospi, kosdaq, disclosurePage, typeCounts, ...typedPages] = await Promise.all([
    getLatestIndexQuote("코스피"),
    getLatestIndexQuote("코스닥"),
    getRecentDisclosuresByStockCode(code, beginDate, endDate),
    getDisclosureTypeCounts(code, beginDate, endDate),
    ...representativeTypes.map((disclosureType) => getDisclosurePageByStockCode(code, beginDate, endDate, 1, { disclosureType })),
  ]);

  const { item, basDt, yearly } = snapshot;
  const stockFact = {
    name: item.itmsNm,
    code: item.srtnCd,
    market: item.mrktCtg,
    baseDate: basDt,
    price: Number(item.clpr),
    change: Number(item.vs),
    changeRate: Number(item.fltRt),
  };

  const disclosureFacts = {
    source: "금융감독원 OpenDART",
    beginDate: disclosurePage.beginDate,
    endDate: disclosurePage.endDate,
    totalCount: disclosurePage.totalCount,
    items: disclosurePage.items,
    typeCounts,
    representative: typedPages.flatMap((page, index) => page.items.map((item) => ({
      ...item,
      disclosureType: representativeTypes[index],
      disclosureTypeLabel: DISCLOSURE_TYPES.find((type) => type.code === representativeTypes[index])!.label,
      selectionReason: "OpenDART 공식 공시유형과 접수일 기준",
    }))).sort((a, b) => b.receiptDate.localeCompare(a.receiptDate)).slice(0, 3),
  };
  const facts: BriefingFacts = {
    generatedAt: formatBaseDateLabel(endDate),
    stock: stockFact,
    marketComparison: buildMarketComparison(
      stockFact,
      [kospi, kosdaq].map((idx) => ({
        name: idx.idxNm,
        baseDate: idx.basDt,
        value: Number(idx.clpr),
        change: Number(idx.vs),
        changeRate: Number(idx.fltRt),
      }))
    ),
    priceFlow: buildPriceFlow(stockFact, yearly.bars),
    disclosures: disclosureFacts,
    unknownCaveats: buildUnknownCaveats(disclosureFacts),
  };
  const packet = buildEvidencePacket(facts);

  // Gemini가 만든 문단은 화면에 바로 보여주지 않는다. 먼저 (1) 우리가 주지
  // 않은 숫자가 섞였는지 프로그램이 직접 확인하고, (2) 통과하면 같은 사실을
  // 다시 주고 투자 추천·목표주가·미래 예측·근거 없는 인과관계가 있는지
  // Gemini에게 한 번 더 검증시킨다. 둘 중 하나라도 걸리면 표시하지 않는다.
  try {
    const briefing = await generateStockBriefing(packet);
    const candidateText = briefingText(briefing);

    const unknownNumbers = findUnknownNumbersFromEvidence(candidateText, packet);
    if (unknownNumbers.length > 0) {
      return {
        facts, packet,
        aiError: `AI가 만든 설명에 우리가 주지 않은 숫자(${unknownNumbers.join(", ")})가 있어 표시하지 않았습니다.`,
        retryable: true,
      };
    }

    const verdict = await verifyStockBriefing(facts, candidateText);
    const violations: string[] = [];
    if (verdict.hasUnprovidedFacts) violations.push("제공되지 않은 사실 포함");
    if (verdict.hasInvestmentRecommendation) violations.push("투자 추천");
    if (verdict.hasTargetPrice) violations.push("목표주가 제시");
    if (verdict.hasFuturePrediction) violations.push("미래 가격·실적 예측");
    if (verdict.hasUnverifiedCausalClaim) violations.push("근거 없는 인과관계 단정");

    if (violations.length > 0) {
      return {
        facts, packet,
        aiError: `AI가 만든 설명이 조건을 지키지 않아 표시하지 않았습니다: ${violations.join(", ")}.`,
        retryable: true,
      };
    }

    return { facts, packet, briefing, model: GEMINI_MODEL_ID, generatedAt: packet.generatedAt };
  } catch (err) {
    return {
      facts, packet,
      aiError: err instanceof Error ? err.message : String(err),
      retryable: isRetryableGeminiError(err),
    };
  }
}
