import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  generateStockBriefing,
  verifyStockBriefing,
  GeminiRateLimitError,
} from "@/lib/gemini-briefing-api";
import type { BriefingFacts } from "@/lib/briefing-facts";

// 이 파일은 실제 Gemini를 부르지 않는다 — "응답이 오래 걸리면 기다리지
// 않는다"·"오류 화면에 비밀값이 남지 않는다"는 실제 키를 일부러 깨뜨리지
// 않고는 매번 똑같이 재현할 방법이 없다. fetch를 대신 채워 넣어 이 두
// 가지를 결정적으로, 반복 가능하게 확인한다. (사실 조회 계층은 다른
// 테스트에서 실제 정부 API로 확인한다.)

const sampleFacts: BriefingFacts = {
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
    totalCount: 1,
    items: [],
  },
  unknownCaveats: ["미래 가격은 이 자료로 알 수 없다."],
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  } as Response;
}

function rateLimitResponse(headers: Record<string, string>, body: unknown): Response {
  const lowered = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok: false,
    status: 429,
    headers: { get: (name: string) => lowered[name.toLowerCase()] ?? null },
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const grounded = (text: string) => ({ text, evidenceIds: ["LIMITS"] });
const structuredBriefing = { headline: "핵심 브리핑 문단.", highlights: [grounded("핵심 요약"), grounded("근거 요약")], marketContext: [grounded("시장 설명")], priceContext: [grounded("가격 설명")], filingContext: [grounded("공시 설명")], unknowns: [grounded("알 수 없는 한계")] };

const originalGeminiKey = process.env.GEMINI_API_KEY;
const TEST_KEY = "TEST_ONLY_FAKE_KEY_abc123";

beforeEach(() => {
  process.env.GEMINI_API_KEY = TEST_KEY;
});

afterEach(() => {
  process.env.GEMINI_API_KEY = originalGeminiKey;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("callGemini의 정상 경로 (generateStockBriefing을 통해 확인)", () => {
  it("candidates의 텍스트를 그대로 돌려준다", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(structuredBriefing) }] } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateStockBriefing(sampleFacts);
    expect(result).toEqual(structuredBriefing);
  });

  it("요청에 tools(인터넷 검색 등)를 절대 넣지 않는다", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        candidates: [{ content: { parts: [{ text: JSON.stringify(structuredBriefing) }] } }],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await generateStockBriefing(sampleFacts);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("tools");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.generationConfig.responseSchema.required).toContain("headline");
    expect(body.generationConfig.responseSchema.required).toContain("unknowns");
    // 키는 헤더로만 보내고, URL 쿼리스트링에는 넣지 않는다(로그에 남지
    // 않게 하려는 조치) — x-goog-api-key로만 전달된다.
    expect(String(url)).not.toContain(TEST_KEY);
    expect(String(url)).not.toContain("key=");
    expect(init.headers).toMatchObject({
      "x-goog-api-key": TEST_KEY,
    });
  });
});

describe("Gemini가 오래 응답하지 않으면 기다리지 않고 중단한다", () => {
  it("타임아웃이 지나면 AbortError를 안내 문구로 바꿔 던진다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: unknown, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const pending = generateStockBriefing(sampleFacts);
    const assertion = expect(pending).rejects.toThrow(/초 안에 오지 않아/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    return err as Error;
  }
  throw new Error("예상과 달리 오류가 나지 않았습니다.");
}

describe("오류 화면에 API 키 값이 남지 않는다", () => {
  it("Gemini가 영어로 돌려준 오류 문구를 그대로 내보내지 않고 사람이 읽는 안내로 바꾼다", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(400, {
        error: { message: `API key ${TEST_KEY} is not valid.` },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(generateStockBriefing(sampleFacts));
    expect(err.message).not.toContain(TEST_KEY);
    expect(err.message).not.toContain("not valid");
    expect(err.message).toContain("API Key가 올바르게 설정됐는지 확인해 주세요");
  });

  it("한도(429)와 일시적인 실패는 다시 눌러 보라고 알려준다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(429, { error: { message: "RESOURCE_EXHAUSTED" } })));
    const quotaError = await captureError(generateStockBriefing(sampleFacts));
    expect(quotaError.message).toContain("한도");
    expect(quotaError.message).toContain("잠시 뒤 다시 눌러 주세요");

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(503, { error: { message: "Service Unavailable" } })));
    const outageError = await captureError(generateStockBriefing(sampleFacts));
    expect(outageError.message).not.toContain("Service Unavailable");
    expect(outageError.message).toContain("잠시 뒤 다시 눌러 주세요");
  });

  it("인증 실패 본문이 JSON이 아니어도 설정 오류로 분류한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, text: async () => "unauthorized" })));
    await expect(generateStockBriefing(sampleFacts)).rejects.toThrow("API Key가 올바르게 설정됐는지");
  });

  it("응답 본문 전체에 키 값이 섞여 있어도(해석 실패 케이스) 원문을 그대로 노출하지 않는다", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => `internal error, key=${TEST_KEY} rejected`,
    }));
    vi.stubGlobal("fetch", fetchMock);

    const err = await captureError(generateStockBriefing(sampleFacts));
    expect(err.message).not.toContain(TEST_KEY);
  });
});

describe("Gemini 응답이 이상할 때의 오류 처리", () => {
  it("구조화 브리핑 필드가 빠지면 형식 오류로 처리한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify({ headline: "제목만 있음" }) }] } }],
    })));
    await expect(generateStockBriefing(sampleFacts)).rejects.toThrow("형식이 예상과 다릅니다");
  });

  it("JSON으로 해석할 수 없는 응답은 명확한 오류로 바뀐다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => "<html>not json</html>",
      }))
    );
    await expect(generateStockBriefing(sampleFacts)).rejects.toThrow(
      "해석할 수 없습니다"
    );
  });

  it("candidates가 비어 있으면 명확한 오류로 바뀐다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {})));
    await expect(generateStockBriefing(sampleFacts)).rejects.toThrow(
      "응답 내용을 돌려주지 않았습니다"
    );
  });
});

describe("구조화 브리핑의 근거 계약 경계", () => {
  async function generateFrom(body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, {
      candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }],
    })));
    return generateStockBriefing(sampleFacts);
  }

  it("알 수 없는 evidence ID와 추가 속성을 거부한다", async () => {
    const unknownId = structuredClone(structuredBriefing);
    unknownId.marketContext[0].evidenceIds = ["NOT_ALLOWED"];
    await expect(generateFrom(unknownId)).rejects.toThrow(/근거가 올바르지/);

    const extraTop = { ...structuredBriefing, extra: true };
    await expect(generateFrom(extraTop)).rejects.toThrow(/형식이 예상과 다릅니다/);

    const extraItem = structuredClone(structuredBriefing) as typeof structuredBriefing & { marketContext: Array<{ text: string; evidenceIds: string[]; extra?: boolean }> };
    extraItem.marketContext[0].extra = true;
    await expect(generateFrom(extraItem)).rejects.toThrow(/형식이 올바르지/);
  });

  it("highlights는 2~3개만 허용한다", async () => {
    await expect(generateFrom({ ...structuredBriefing, highlights: [grounded("하나뿐인 요약")] })).rejects.toThrow(/항목 수/);
    await expect(generateFrom({ ...structuredBriefing, highlights: [grounded("요약 하나"), grounded("요약 둘"), grounded("요약 셋"), grounded("요약 넷")] })).rejects.toThrow(/항목 수/);
  });

  it("근거에 없는 숫자와 투자·인과 표현을 거부한다", async () => {
    const number = structuredClone(structuredBriefing);
    number.priceContext[0].text = "근거에 없는 값은 999999원이다.";
    await expect(generateFrom(number)).rejects.toThrow(/근거 없는 숫자/);

    const recommendation = structuredClone(structuredBriefing);
    recommendation.marketContext[0].text = "지금 매수하는 것이 좋다.";
    await expect(generateFrom(recommendation)).rejects.toThrow(/금지 표현/);

    const causal = structuredClone(structuredBriefing);
    causal.filingContext[0].text = "공시 때문에 가격이 변했다.";
    await expect(generateFrom(causal)).rejects.toThrow(/금지 표현/);
  });

  it("정상 계약은 통과한다", async () => {
    await expect(generateFrom(structuredBriefing)).resolves.toEqual(structuredBriefing);
  });
});

describe("Gemini 사용량 한도(429)", () => {
  it("Retry-After 헤더와 RetryInfo를 안전한 전용 오류로 보존한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rateLimitResponse({ "retry-after": "13" }, { error: { message: `비밀 ${TEST_KEY}` } })));
    const headerError = await captureError(generateStockBriefing(sampleFacts));
    expect(headerError).toBeInstanceOf(GeminiRateLimitError);
    expect((headerError as GeminiRateLimitError).retryAfterSeconds).toBe(13);
    expect(headerError.message).not.toContain(TEST_KEY);

    vi.stubGlobal("fetch", vi.fn(async () => rateLimitResponse({}, { error: { details: [{ retryDelay: "13.5s" }] } })));
    const bodyError = await captureError(generateStockBriefing(sampleFacts));
    expect(bodyError).toBeInstanceOf(GeminiRateLimitError);
    expect((bodyError as GeminiRateLimitError).retryAfterSeconds).toBe(13.5);
  });

  it("재시도 시각을 알 수 없으면 null로 두고 원문을 노출하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rateLimitResponse({}, { error: { message: `키 ${TEST_KEY} 한도 초과` } })));
    const error = await captureError(generateStockBriefing(sampleFacts));
    expect(error).toBeInstanceOf(GeminiRateLimitError);
    expect((error as GeminiRateLimitError).retryAfterSeconds).toBeNull();
    expect(error.message).not.toContain(TEST_KEY);
  });
});

describe("verifyStockBriefing — 2단계 검증 호출의 응답 처리", () => {
  it("스키마에 맞는 JSON 판정 결과를 그대로 돌려준다", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      hasUnprovidedFacts: false,
                      hasInvestmentRecommendation: false,
                      hasTargetPrice: true,
                      hasFuturePrediction: false,
                      hasUnverifiedCausalClaim: false,
                      reason: "목표주가를 제시함",
                    }),
                  },
                ],
              },
            },
          ],
        })
      )
    );

    const verdict = await verifyStockBriefing(sampleFacts, "검사할 문단");
    expect(verdict.hasTargetPrice).toBe(true);
    expect(verdict.hasUnprovidedFacts).toBe(false);
    expect(verdict.reason).toBe("목표주가를 제시함");
  });

  it("필드가 빠지거나 타입이 다르면 형식 오류로 처리한다(true/false 강제 없이 통과시키지 않음)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ hasTargetPrice: "아니오" }) }],
              },
            },
          ],
        })
      )
    );

    await expect(
      verifyStockBriefing(sampleFacts, "검사할 문단")
    ).rejects.toThrow("형식이 예상과 다릅니다");
  });
});
