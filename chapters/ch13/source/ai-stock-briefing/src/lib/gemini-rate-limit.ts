import "server-only";
import { getRedis, isUpstashConfigured, toSafeRedisError } from "@/lib/redis";

export const GEMINI_RATE_LIMIT_REDIS_KEY = "gemini:rate-limit";

// Gemini가 재시도 시간을 안 알려줄 때 쓰는 기본 대기 시간. 무료 등급의
// 분당 요청 수(RPM) 제한은 보통 1분 단위로 풀리므로 60초를 기본값으로 둔다.
const DEFAULT_RETRY_SECONDS = 60;

export interface GeminiRateLimitState {
  // 이 시각까지는 Gemini를 다시 부르지 않는다.
  blockedUntil: string;
  // true면 Gemini 응답에서 실제로 확인한 시각이고, false면 확인하지 못해
  // 기본 대기 시간으로 추정한 값이다 — 화면에는 true일 때만 이 시각을
  // 보여준다(확인되지 않은 값을 확인된 것처럼 보여주지 않는다).
  retryTimeKnown: boolean;
}

// Upstash Redis가 설정되지 않았거나 일시적으로 응답하지 않을 때를 위한,
// 이 서버 프로세스 안에서만 유지하는 대체 저장소.
let inMemoryState: GeminiRateLimitState | null = null;

function isExpired(state: GeminiRateLimitState): boolean {
  return new Date(state.blockedUntil).getTime() <= Date.now();
}

// null이면 지금 바로 Gemini를 불러도 된다는 뜻이다.
export async function getGeminiRateLimitState(): Promise<GeminiRateLimitState | null> {
  if (isUpstashConfigured()) {
    try {
      const state = await getRedis().get<GeminiRateLimitState>(GEMINI_RATE_LIMIT_REDIS_KEY);
      // Redis에 저장할 때 만료 시간을 blockedUntil과 맞춰 두었으므로, 키가
      // 남아 있다는 것 자체가 아직 유효하다는 뜻이다.
      return state ?? null;
    } catch (err) {
      console.warn(
        "Gemini 한도 상태 확인 중 문제가 있어 이 서버가 기억하는 값으로 대신 확인합니다:",
        toSafeRedisError(err).message
      );
    }
  }
  return inMemoryState && !isExpired(inMemoryState) ? inMemoryState : null;
}

// Gemini가 429(한도 도달)를 돌려줬을 때 호출한다. retryAfterSeconds가
// null이면(Gemini가 재시도 시간을 안 알려준 경우) 기본 대기 시간을 쓴다.
export async function recordGeminiRateLimit(
  retryAfterSeconds: number | null
): Promise<GeminiRateLimitState> {
  const seconds =
    retryAfterSeconds !== null && retryAfterSeconds > 0
      ? retryAfterSeconds
      : DEFAULT_RETRY_SECONDS;
  const state: GeminiRateLimitState = {
    blockedUntil: new Date(Date.now() + seconds * 1000).toISOString(),
    retryTimeKnown: retryAfterSeconds !== null,
  };

  inMemoryState = state;

  if (isUpstashConfigured()) {
    try {
      await getRedis().set(GEMINI_RATE_LIMIT_REDIS_KEY, state, {
        ex: Math.max(1, Math.ceil(seconds)),
      });
    } catch (err) {
      console.warn(
        "Gemini 한도 상태 저장 중 문제가 있어 건너뜁니다:",
        toSafeRedisError(err).message
      );
    }
  }

  return state;
}

// 테스트에서 이 프로세스가 기억하는 값을 비우기 위한 용도로만 쓴다.
export function resetGeminiRateLimitForTesting(): void {
  inMemoryState = null;
}
