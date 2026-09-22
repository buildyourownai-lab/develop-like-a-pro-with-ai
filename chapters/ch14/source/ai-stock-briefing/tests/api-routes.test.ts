import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { getRedis, isUpstashConfigured } from "@/lib/redis";
import {
  GEMINI_RATE_LIMIT_REDIS_KEY,
  resetGeminiRateLimitForTesting,
} from "@/lib/gemini-rate-limit";

// Android/iOS 앱이 부를 JSON API 경계(src/app/api/**)가 웹 화면과 같은
// 자료·같은 의미의 값을 돌려주는지, Secret이 응답에 섞이지 않는지 확인한다.
// 시세·지수·공시는 이 프로젝트의 다른 테스트와 같이 실제 API를 그대로 쓰고,
// Gemini(브리핑) 호출만 가짜로 바꾼다.

const { generateStockBriefing, verifyStockBriefing } = vi.hoisted(() => ({
  generateStockBriefing: vi.fn(),
  verifyStockBriefing: vi.fn(),
}));
vi.mock("@/lib/gemini-briefing-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/gemini-briefing-api")>();
  return { ...actual, generateStockBriefing, verifyStockBriefing };
});

const HYNIX_CODE = "000660";

const SECRET_ENV_KEYS = [
  "DATA_GO_KR_SERVICE_KEY",
  "OPEN_DART_API_KEY",
  "GEMINI_API_KEY",
  "SUPABASE_DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

function expectNoSecretLeak(body: unknown) {
  const text = JSON.stringify(body);
  for (const key of SECRET_ENV_KEYS) {
    const value = process.env[key];
    if (value) expect(text.includes(value)).toBe(false);
    expect(text.includes(key)).toBe(false);
  }
}

beforeEach(async () => {
  resetGeminiRateLimitForTesting();
  if (!isUpstashConfigured()) return;
  const redis = getRedis();
  const keys = await redis.keys(`briefing:${HYNIX_CODE}:*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.del(GEMINI_RATE_LIMIT_REDIS_KEY);
});

afterEach(() => {
  generateStockBriefing.mockReset();
  verifyStockBriefing.mockReset();
});

describe("GET /api/market", () => {
  it("시장 화면과 같은 지수·상위/하위 5개·기준일을 돌려주고 Secret이 없다", async () => {
    const { GET } = await import("../src/app/api/market/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.indices).toHaveLength(2);
    expect(body.topGainers.length).toBeLessThanOrEqual(5);
    expect(body.topLosers.length).toBeLessThanOrEqual(5);
    expect(typeof body.stockBaseDate).toBe("string");
    expectNoSecretLeak(body);
  });
});

describe("GET /api/stocks/search", () => {
  it("검색어가 없으면 400을 돌려준다", async () => {
    const { GET } = await import("../src/app/api/stocks/search/route");
    const req = new NextRequest("http://localhost/api/stocks/search");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("정확한 종목명으로 검색하면 SK하이닉스 하나를 찾는다", async () => {
    const { GET } = await import("../src/app/api/stocks/search/route");
    const req = new NextRequest(
      "http://localhost/api/stocks/search?q=" + encodeURIComponent("SK하이닉스")
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].code).toBe(HYNIX_CODE);
    expectNoSecretLeak(body);
  });
});

describe("GET /api/stocks/[code]", () => {
  it("존재하지 않는 종목코드는 404를 돌려준다", async () => {
    const { GET } = await import("../src/app/api/stocks/[code]/route");
    const res = await GET(new Request("http://localhost/api/stocks/999999"), {
      params: Promise.resolve({ code: "999999" }),
    });
    expect(res.status).toBe(404);
  });

  it("SK하이닉스 상세는 종목 기준일·지수 기준일을 각각 담고, 1년 차트와 최근 공시를 포함한다", async () => {
    const { GET } = await import("../src/app/api/stocks/[code]/route");
    const res = await GET(
      new Request(`http://localhost/api/stocks/${HYNIX_CODE}`),
      { params: Promise.resolve({ code: HYNIX_CODE }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.name).toBe("SK하이닉스");
    expect(body.code).toBe(HYNIX_CODE);
    expect(typeof body.basDt).toBe("string");
    expect(typeof body.marketBaseDate).toBe("string");
    expect(typeof body.baseDateDiffers).toBe("boolean");
    // 기준가 대비 값 — 종가에서 대비를 빼면 기준가가 된다.
    expect(body.basePrice).toBe(body.price - body.change);

    expect(Array.isArray(body.chart.bars)).toBe(true);
    expect(body.chart.bars.length).toBeGreaterThan(0);
    for (const bar of body.chart.bars) {
      expect(typeof bar.basDt).toBe("string");
      expect(Number.isFinite(bar.close)).toBe(true);
    }

    // recentDisclosures는 최대 5건, chartDisclosureMarkers는 정기공시·
    // 주요사항보고만 담아야 한다(오류 응답 형태({error})일 수도 있다).
    if (!("error" in body.recentDisclosures)) {
      expect(body.recentDisclosures.items.length).toBeLessThanOrEqual(5);
    }
    if ("markers" in body.chartDisclosureMarkers) {
      for (const marker of body.chartDisclosureMarkers.markers) {
        expect(["A", "B"]).toContain(marker.disclosureType);
      }
    }

    // 정부 API 원본 필드명(clpr/vs/srtnCd 등)이 그대로 노출되면 안 된다.
    const text = JSON.stringify(body);
    for (const rawField of ["clpr", "fltRt", "mkp", "hipr", "lopr", "trqu", "trPrc"]) {
      expect(text.includes(rawField)).toBe(false);
    }
    expectNoSecretLeak(body);
  });
});

describe("GET /api/stocks/[code]/disclosures", () => {
  it("100건 단위 페이지네이션과 공식 공시유형 10종의 건수를 돌려준다", async () => {
    const { GET } = await import(
      "../src/app/api/stocks/[code]/disclosures/route"
    );
    const res = await GET(
      new Request(`http://localhost/api/stocks/${HYNIX_CODE}/disclosures?page=1`),
      { params: Promise.resolve({ code: HYNIX_CODE }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.page.pageNo).toBe(1);
    expect(body.page.items.length).toBeLessThanOrEqual(100);
    expect(body.typeCounts).toHaveLength(10);
    expectNoSecretLeak(body);
  });

  it("알 수 없는 type 값은 필터 없이 처리한다(전체 공시 화면과 같은 동작)", async () => {
    const { GET } = await import(
      "../src/app/api/stocks/[code]/disclosures/route"
    );
    const res = await GET(
      new Request(
        `http://localhost/api/stocks/${HYNIX_CODE}/disclosures?type=Z`
      ),
      { params: Promise.resolve({ code: HYNIX_CODE }) }
    );
    const body = await res.json();
    expect(body.page.disclosureType).toBeNull();
  });
});

describe("POST /api/stocks/[code]/briefing", () => {
  it("웹과 같은 facts/packet/구조화 briefing 계약을 돌려준다", async () => {
    const grounded = (text: string) => ({ text, evidenceIds: ["LIMITS"] });
    generateStockBriefing.mockResolvedValue({
      headline: "확인된 근거 요약",
      highlights: [grounded("핵심 요약"), grounded("근거 요약")],
      marketContext: [grounded("시장 설명")],
      priceContext: [grounded("가격 설명")],
      filingContext: [grounded("공시 설명")],
      unknowns: [grounded("알 수 없는 내용")],
    });
    verifyStockBriefing.mockResolvedValue({
      hasUnprovidedFacts: false,
      hasInvestmentRecommendation: false,
      hasTargetPrice: false,
      hasFuturePrediction: false,
      hasUnverifiedCausalClaim: false,
      reason: "문제 없음",
    });

    const { POST } = await import(
      "../src/app/api/stocks/[code]/briefing/route"
    );
    const res = await POST(
      new Request(`http://localhost/api/stocks/${HYNIX_CODE}/briefing`, {
        method: "POST",
      }),
      { params: Promise.resolve({ code: HYNIX_CODE }) }
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.facts.stock.name).toBe("SK하이닉스");
    expect(body.facts.unknownCaveats.length).toBeGreaterThan(0);
    expect(body.packet.observations.length).toBeGreaterThan(0);
    expect(body.briefing.headline).toBe("확인된 근거 요약");
    expect(body.briefing.highlights).toHaveLength(2);
    expect(typeof body.model).toBe("string");
    expectNoSecretLeak(body);
  });
});
