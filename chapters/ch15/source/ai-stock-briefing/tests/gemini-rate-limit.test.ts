import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/redis", () => ({
  isUpstashConfigured: () => false,
  getRedis: vi.fn(),
  toSafeRedisError: (error: unknown) => error instanceof Error ? error : new Error(String(error)),
}));

const { getGeminiRateLimitState, recordGeminiRateLimit, resetGeminiRateLimitForTesting } = await import("@/lib/gemini-rate-limit");

beforeEach(() => resetGeminiRateLimitForTesting());

describe("Gemini 차단 시각의 로컬 대체 저장소", () => {
  it("429 재시도 시각을 저장하고 만료 전에는 차단 상태를 돌려준다", async () => {
    const state = await recordGeminiRateLimit(13);
    expect(state.retryTimeKnown).toBe(true);
    expect(new Date(state.blockedUntil).getTime()).toBeGreaterThan(Date.now());
    expect(await getGeminiRateLimitState()).toEqual(state);
  });

  it("Gemini가 시각을 주지 않으면 기본 대기 시간을 쓰되 확인값으로 표시하지 않는다", async () => {
    const state = await recordGeminiRateLimit(null);
    expect(state.retryTimeKnown).toBe(false);
    expect(new Date(state.blockedUntil).getTime()).toBeGreaterThan(Date.now());
  });
});
