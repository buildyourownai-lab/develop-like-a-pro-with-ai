import type { BriefingFacts } from "./briefing-facts";
import {
  formatBaseDateLabel,
  formatChangeRate,
  formatPrice,
} from "./format";

// Gemini에게 보내는 사실 블록을 만든다. 생성(buildPrompt)과 검증
// (buildVerificationPrompt)이 같은 블록을 쓴다 — 검증자가 생성자와 다른
// 사실을 보면 검증 자체가 의미가 없어지기 때문에, 단일 함수로 만들어 둘이
// 항상 같은 내용을 보게 한다.
//
// 이 함수를 별도 파일로 둔 이유: briefing-verify.ts도 이 블록을 읽는다.
// "우리가 준 숫자"의 기준은 facts 객체의 필드가 아니라 여기서 만든 이
// 문자열이다 — Gemini가 보는 것이 이 문자열이기 때문이다.
export function buildFactsBlock(facts: BriefingFacts): string {
  const { stock, marketComparison, priceFlow, disclosures, unknownCaveats } = facts;

  const comparisonLines = marketComparison
    .map(
      (m) =>
        `- ${m.indexName}(기준일 ${formatBaseDateLabel(m.indexBaseDate)}) 등락률 ${formatChangeRate(m.indexChangeRate)} · ${stock.name} 등락률 ${formatChangeRate(m.stockChangeRate)} · 차이 ${formatChangeRate(m.deltaPp)}p · "${m.magnitude}" 차이${m.isOwnMarket ? " (이 종목이 속한 시장)" : ""}`
    )
    .join("\n");

  const priceFlowLines = [
    `현재가(${formatBaseDateLabel(priceFlow.currentBaseDate)}): ${formatPrice(priceFlow.currentPrice)} (당일 등락률 ${formatChangeRate(priceFlow.currentChangeRate)})`,
    `1년 전 시작가(${formatBaseDateLabel(priceFlow.periodStartDate)}): ${formatPrice(priceFlow.periodStartPrice)}`,
    `1년간 변동률(프로그램이 계산한 값): ${
      priceFlow.periodChangeRate === null
        ? "계산 불가(시작 종가 0)"
        : formatChangeRate(priceFlow.periodChangeRate)
    }`,
    `1년 중 최고가(실제 거래가 있었던 날만 계산): ${
      priceFlow.yearHigh
        ? `${formatPrice(priceFlow.yearHigh.price)} (${formatBaseDateLabel(priceFlow.yearHigh.basDt)})`
        : "계산 불가(거래된 날 없음)"
    }`,
    `1년 중 최저가(실제 거래가 있었던 날만 계산): ${
      priceFlow.yearLow
        ? `${formatPrice(priceFlow.yearLow.price)} (${formatBaseDateLabel(priceFlow.yearLow.basDt)})`
        : "계산 불가(거래된 날 없음)"
    }`,
  ];
  if (priceFlow.noTradeDayCount > 0) {
    priceFlowLines.push(
      `참고: 이 기간 중 거래정지 등으로 거래가 없었던 날 ${priceFlow.noTradeDayCount}일은 최고가·최저가 계산에서 제외했다.`
    );
  }

  const disclosureLines =
    disclosures.items.length > 0
      ? disclosures.items
          .map((d) => `- ${formatBaseDateLabel(d.receiptDate)} ${d.reportName} (제출인: ${d.submitter})`)
          .join("\n")
      : "(이 기간 접수된 공시 없음)";

  const caveatLines = unknownCaveats.map((c) => `- ${c}`).join("\n");

  return `[시세 — 금융위원회 주식시세정보, 기준일 ${stock.baseDate}]
종가: ${formatPrice(stock.price)} (전일대비 ${formatChangeRate(stock.changeRate)})

[시장과 종목 비교 — 금융위원회 지수시세정보, 프로그램이 계산한 차이(%p)]
${comparisonLines}

[최근 가격 흐름 — ${priceFlow.source}]
${priceFlowLines.join("\n")}

[최근 1년 공시 — 금융감독원 OpenDART, ${disclosures.beginDate}~${disclosures.endDate} 전체 ${disclosures.totalCount}건 중 최근 목록]
${disclosureLines}

[이 자료로 알 수 없는 것]
${caveatLines}`;
}
