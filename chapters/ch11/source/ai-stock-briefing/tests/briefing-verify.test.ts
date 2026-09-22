import { describe, it, expect } from "vitest";
import { findUnknownNumbers, findUnknownNumbersFromEvidence } from "@/lib/briefing-verify";
import type { BriefingFacts } from "@/lib/briefing-facts";

// findUnknownNumbers는 briefing-actions.ts가 실제로 만드는 BriefingFacts와
// 같은 모양이어야 한다 — 필드를 하나라도 놓치면 그 필드에서 나온 숫자를
// "모르는 숫자"로 잘못 판정할 수 있다.
function facts(overrides: Partial<BriefingFacts> = {}): BriefingFacts {
  return {
    generatedAt: "2026-08-30",
    stock: {
      name: "SK하이닉스",
      code: "000660",
      market: "KOSPI",
      baseDate: "20260827",
      price: 1730000,
      change: 42000,
      changeRate: 2.49,
    },
    marketComparison: [
      {
        indexName: "코스피",
        indexBaseDate: "20260827",
        indexChangeRate: 1.53,
        stockChangeRate: 2.49,
        deltaPp: 0.96,
        magnitude: "비슷한 수준",
        isOwnMarket: true,
      },
    ],
    priceFlow: {
      source: "금융위원회 주식시세정보(일별)",
      currentPrice: 1730000,
      currentChangeRate: 2.49,
      currentBaseDate: "20260827",
      periodStartPrice: 256000,
      periodStartDate: "20250901",
      periodEndPrice: 1730000,
      periodEndDate: "20260827",
      periodChangeRate: 575.78,
      yearHigh: { price: 2987000, basDt: "20260625" },
      yearLow: { price: 255000, basDt: "20250901" },
      noTradeDayCount: 0,
      tradingDayCount: 244,
      currentVolume: 2630000,
    },
    disclosures: {
      source: "금융감독원 OpenDART",
      beginDate: "20250830",
      endDate: "20260830",
      totalCount: 477,
      items: [
        {
          receiptNo: "20260828000879",
          receiptDate: "20260828",
          reportName: "반기보고서 (2026.06)",
          submitter: "SK하이닉스",
          remarks: "",
          dartUrl: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260828000879",
        },
      ],
    },
    unknownCaveats: [],
    ...overrides,
  };
}

describe("findUnknownNumbers — Gemini 문장의 숫자를 프로그램이 준 사실과 대조한다", () => {
  it("사실을 그대로 옮긴 문장에는 모르는 숫자가 없다", () => {
    const text =
      "SK하이닉스의 종가는 1,730,000원으로 전일대비 +2.49% 상승했다. " +
      "코스피 등락률(+1.53%)과 비교했을 때 차이는 +0.96%p였다.";
    expect(findUnknownNumbers(text, facts())).toEqual([]);
  });

  it("천 단위 구분 쉼표가 있어도 올바르게 인식한다(1과 730과 000으로 잘못 쪼개지지 않음)", () => {
    const text = "최고가는 2,987,000원이었다.";
    expect(findUnknownNumbers(text, facts())).toEqual([]);
  });

  it("쉼표 그룹이 3개 이상(10억 단위) 지어낸 숫자도 온전히 하나로 인식해 걸러낸다", () => {
    // 쉼표를 그룹 단위로 하나씩 지우는 방식은 그룹이 3개 이상일 때 가운데
    // 쉼표가 하나 남는 문제가 있었다("9,999,999,999" → "9999,999999").
    // 그 상태로는 "9999"·"999999" 두 조각으로 쪼개져, 실제로는 없는 숫자를
    // 우연히 다른 허용 숫자와 헷갈릴 위험이 있었다 — 반드시 통째로
    // "9999999999" 하나로 인식해야 한다.
    const text = "목표가는 9,999,999,999원까지 오를 수 있다.";
    expect(findUnknownNumbers(text, facts())).toEqual(["9999999999"]);
  });

  it("날짜를 다른 형식으로 옮겨 써도(연/월/일 분리) 인식한다", () => {
    const text = "2026년 8월 27일 기준, 2025년 9월 1일부터 시작됐다.";
    expect(findUnknownNumbers(text, facts())).toEqual([]);
  });

  it("공시 제목 안의 숫자도 그대로 인용하면 허용한다", () => {
    const text = "최근 공시로 반기보고서 (2026.06)가 있었다.";
    expect(findUnknownNumbers(text, facts())).toEqual([]);
  });

  it("우리가 보낸 문장에 있는 표현(최근 1년)의 숫자는 모르는 숫자로 판정하지 않는다", () => {
    // Gemini에게 보내는 자료에는 계산된 숫자만 있는 것이 아니라 "1년 전
    // 시작가"·"최근 1년 공시"처럼 우리가 붙인 설명도 함께 들어간다. Gemini는
    // 그 표현을 그대로 옮겨 쓰므로, 계산된 숫자만 기준으로 삼으면 정상적인
    // 브리핑이 "우리가 주지 않은 숫자(1)"로 매번 막힌다.
    const text = "최근 1년간 주가는 크게 올랐고, 1년 전 시작가는 256,000원이었다.";
    expect(findUnknownNumbers(text, facts())).toEqual([]);
  });

  it("우리가 준 적 없는 숫자(지어낸 목표가)는 걸러낸다", () => {
    const text = "목표가는 2,500,000원으로 예상된다.";
    expect(findUnknownNumbers(text, facts())).toContain("2500000");
  });

  it("우리가 준 적 없는 미래 예측 수치(임의의 %)도 걸러낸다", () => {
    const text = "앞으로 15% 더 오를 것으로 보인다.";
    expect(findUnknownNumbers(text, facts())).toContain("15");
  });

  it("periodChangeRate가 null이면 그 어떤 변동률 숫자도 허용하지 않는다", () => {
    const withoutRate = facts({
      priceFlow: {
        ...facts().priceFlow,
        periodChangeRate: null,
      },
    });
    const text = "1년간 변동률은 575.78%였다.";
    expect(findUnknownNumbers(text, withoutRate)).toContain("575.78");
  });
});

describe("실제 EvidencePacket 숫자 대조", () => {
  it("전달한 날짜·거래일·공시 숫자는 허용하고 새 숫자는 거부한다", () => {
    const packet = {
      observations: [
        { text: "20250903부터 20260903까지 거래일은 244일이다." },
        { text: "20260904 공시가 접수됐다." },
      ],
      limits: ["목표주가는 알 수 없다."],
    };
    expect(findUnknownNumbersFromEvidence(
      "20250903부터 244일이며 20260904 공시가 있었다.", packet
    )).toEqual([]);
    expect(findUnknownNumbersFromEvidence("수익률은 777%다.", packet)).toEqual(["777"]);
  });
});
