import { describe, it, expect, vi, afterEach } from "vitest";

// generateStockBriefing·verifyStockBriefing(Gemini 호출)만 가짜로 바꾼다.
// 시세·지수·공시 조회는 이 프로젝트의 다른 테스트와 똑같이 실제 금융위원회·
// OpenDART API를 그대로 부른다 — "프로그램이 계산한 숫자"가 실제 데이터
// 기준으로 맞는지를 이 테스트가 같이 확인해 준다. Gemini 쪽만 통제해야
// "검사가 걸러내는지"·"Gemini가 실패하면 어떻게 안내하는지"를 매번 같은
// 조건으로, 실제 키를 건드리지 않고 재현할 수 있다.
const { generateStockBriefing, verifyStockBriefing } = vi.hoisted(() => ({
  generateStockBriefing: vi.fn(),
  verifyStockBriefing: vi.fn(),
}));
vi.mock("@/lib/gemini-briefing-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gemini-briefing-api")>()),
  generateStockBriefing,
  verifyStockBriefing,
}));

const { generateStockBriefingAction } = await import(
  "../src/app/stocks/[code]/briefing-actions"
);

const HYNIX_CODE = "000660";

function passingVerdict() {
  return {
    hasUnprovidedFacts: false,
    hasInvestmentRecommendation: false,
    hasTargetPrice: false,
    hasFuturePrediction: false,
    hasUnverifiedCausalClaim: false,
    reason: "문제 없음",
  };
}

function structured(text: string) {
  const item = (value: string) => ({ text: value, evidenceIds: ["LIMITS"] });
  return { headline: text, highlights: [item(text), item("확인된 자료만 요약했다.")], marketContext: [item("시장 비교")], priceContext: [item("가격 흐름")], filingContext: [item("공시 사실")], unknowns: [item("알 수 없음")] };
}

afterEach(() => {
  generateStockBriefing.mockReset();
  verifyStockBriefing.mockReset();
});

describe("generateStockBriefingAction — 정상 경로", () => {
  it("실제 SK하이닉스 시세·지수·공시로 계산한 사실과, 검증을 통과한 AI 설명을 함께 돌려준다", async () => {
    // Gemini가 실제로 받았을 사실(facts)만 근거로, 그 안의 실제 숫자를
    // 그대로 옮겨 인용하는 문장을 만든다 — "프로그램이 준 사실과 어긋나지
    // 않는 정상 응답"을 실제 데이터 기준으로 흉내낸다.
    generateStockBriefing.mockResolvedValue(structured("확인된 사실을 근거로 정리했다."));
    verifyStockBriefing.mockResolvedValue(passingVerdict());

    const result = await generateStockBriefingAction(HYNIX_CODE);

    expect("error" in result).toBe(false);
    if ("error" in result) return;

    expect(result.facts.stock.name).toBe("SK하이닉스");
    expect(result.facts.stock.code).toBe("000660");
    expect(result.facts.stock.market).toBe("KOSPI");
    expect(result.facts.stock.price).toBeGreaterThan(0);
    expect(Number.isFinite(result.facts.stock.changeRate)).toBe(true);

    // 시장 비교 — 코스피·코스닥 둘 다 있고, 차이는 종목-지수 등락률로
    // 계산된 값이어야 한다(부호까지 정확히).
    expect(result.facts.marketComparison).toHaveLength(2);
    for (const m of result.facts.marketComparison) {
      const expectedDelta =
        Math.round((m.stockChangeRate - m.indexChangeRate) * 100) / 100;
      expect(m.deltaPp).toBe(expectedDelta);
    }

    // 가격 흐름 — 실제 1년치 데이터가 있으므로 계산 불가(null)이면 안 된다.
    expect(result.facts.priceFlow.periodChangeRate).not.toBeNull();
    expect(result.facts.priceFlow.yearHigh).not.toBeNull();
    expect(result.facts.priceFlow.yearLow).not.toBeNull();

    // 공시 — 최근 목록은 5건 이하이고, 전체 건수는 그보다 크거나 같다.
    expect(result.facts.disclosures.items.length).toBeLessThanOrEqual(5);
    expect(result.facts.disclosures.totalCount).toBeGreaterThanOrEqual(
      result.facts.disclosures.items.length
    );

    expect("briefing" in result).toBe(true);
    if ("briefing" in result) {
      expect(result.briefing.headline).toBe("확인된 사실을 근거로 정리했다.");
    }
    expect(verifyStockBriefing).toHaveBeenCalledTimes(1);
  });
});

describe("generateStockBriefingAction — 근거 밖 내용을 걸러낸다", () => {
  it("Gemini 문장에 우리가 준 적 없는 숫자가 있으면 화면에 보여주지 않고, 검증 호출도 하지 않는다", async () => {
    generateStockBriefing.mockResolvedValue(structured("이 종목은 목표가 9,999,999,999원까지 오를 수 있다."));
    verifyStockBriefing.mockResolvedValue(passingVerdict());

    const result = await generateStockBriefingAction(HYNIX_CODE);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect("briefing" in result).toBe(false);
    expect("aiError" in result).toBe(true);
    if ("aiError" in result) {
      expect(result.aiError).toContain("우리가 주지 않은 숫자");
      expect(result.aiError).toContain("9999999999");
    }
    // 숫자 대조에서 이미 걸러졌으므로, 비용이 드는 2단계(Gemini) 검증까지
    // 갈 필요가 없다 — 호출되지 않아야 한다.
    expect(verifyStockBriefing).not.toHaveBeenCalled();
    // 숫자 검사가 걸러내도 "프로그램이 확인한 사실"은 그대로 남아 있어야
    // 한다 — 화면에서 이 부분은 항상 보여줄 수 있어야 하기 때문이다.
    expect(result.facts.stock.name).toBe("SK하이닉스");
  });

  it("숫자는 문제없지만 Gemini 자체가 금지 항목(목표주가 등)을 만들면 화면에 보여주지 않는다", async () => {
    generateStockBriefing.mockResolvedValue(structured("이 종목은 최근 1년간 크게 올랐고, 목표주가를 제시한다."));
    verifyStockBriefing.mockResolvedValue({
      ...passingVerdict(),
      hasTargetPrice: true,
      reason: "목표주가를 제시함",
    });

    const result = await generateStockBriefingAction(HYNIX_CODE);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect("briefing" in result).toBe(false);
    expect("aiError" in result).toBe(true);
    if ("aiError" in result) {
      expect(result.aiError).toContain("조건을 지키지 않아");
      expect(result.aiError).toContain("목표주가 제시");
    }
    expect(result.facts.stock.name).toBe("SK하이닉스");
  });

  it("Gemini가 금지 항목을 여러 개 어기면 그 항목을 모두 안내한다", async () => {
    generateStockBriefing.mockResolvedValue(structured("이 종목은 매수하기 좋고 곧 오를 것이다."));
    verifyStockBriefing.mockResolvedValue({
      ...passingVerdict(),
      hasInvestmentRecommendation: true,
      hasFuturePrediction: true,
      reason: "매수 추천과 미래 예측이 섞여 있음",
    });

    const result = await generateStockBriefingAction(HYNIX_CODE);
    if ("error" in result || "briefing" in result) throw new Error("예상과 다른 결과");
    expect(result.aiError).toContain("투자 추천");
    expect(result.aiError).toContain("미래 가격·실적 예측");
  });
});

describe("generateStockBriefingAction — Gemini가 실패해도 나머지 기능은 그대로 동작한다", () => {
  it("Gemini 생성 호출이 실패(타임아웃 등)해도 프로그램이 계산한 사실은 그대로 돌아온다", async () => {
    generateStockBriefing.mockRejectedValue(
      new Error("Gemini 응답이 20초 안에 오지 않아 기다리지 않고 중단했습니다.")
    );

    const result = await generateStockBriefingAction(HYNIX_CODE);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect("briefing" in result).toBe(false);
    expect("aiError" in result).toBe(true);
    if ("aiError" in result) {
      expect(result.aiError).toContain("20초 안에 오지 않아");
    }

    // AI 설명이 실패해도, 시세·시장 비교·가격 흐름·공시는 여전히 실제
    // 데이터로 채워져 있어야 한다 — 이 부분이 "다른 화면 기능은 계속
    // 동작한다"의 핵심이다.
    expect(result.facts.stock.name).toBe("SK하이닉스");
    expect(result.facts.priceFlow.currentPrice).toBeGreaterThan(0);
    expect(result.facts.disclosures.totalCount).toBeGreaterThanOrEqual(0);
    expect(verifyStockBriefing).not.toHaveBeenCalled();
  });

  it("2단계 검증 호출 자체가 실패해도 사실은 그대로 돌아오고 원인이 안내된다", async () => {
    generateStockBriefing.mockResolvedValue(structured("사실만 담은 정상적인 문장이다."));
    verifyStockBriefing.mockRejectedValue(
      new Error("Gemini 검증 결과를 해석할 수 없습니다.")
    );

    const result = await generateStockBriefingAction(HYNIX_CODE);

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect("briefing" in result).toBe(false);
    if ("aiError" in result) {
      expect(result.aiError).toContain("해석할 수 없습니다");
    }
    expect(result.facts.stock.code).toBe("000660");
  });

  it("인증·모델 설정 오류는 재시도 불가로, 일시 오류는 재시도 가능으로 구분한다", async () => {
    generateStockBriefing.mockRejectedValue(new Error("Gemini 인증에 실패했습니다. API Key가 올바르게 설정됐는지 확인해 주세요."));
    const auth = await generateStockBriefingAction(HYNIX_CODE);
    expect("aiError" in auth && auth.retryable).toBe(false);

    generateStockBriefing.mockRejectedValue(new Error("Gemini 호출에 실패했습니다. 잠시 뒤 다시 눌러 주세요."));
    const temporary = await generateStockBriefingAction(HYNIX_CODE);
    expect("aiError" in temporary && temporary.retryable).toBe(true);
  });
});

describe("generateStockBriefingAction — 존재하지 않는 종목", () => {
  it("시세를 찾지 못하면 Gemini를 부르지 않고 바로 오류를 돌려준다", async () => {
    const result = await generateStockBriefingAction("999999");
    expect("error" in result).toBe(true);
    expect(generateStockBriefing).not.toHaveBeenCalled();
    expect(verifyStockBriefing).not.toHaveBeenCalled();
  });
});
