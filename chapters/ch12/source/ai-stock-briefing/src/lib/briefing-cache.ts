import "server-only";
import crypto from "node:crypto";
import { getRedis, isUpstashConfigured, toSafeRedisError } from "@/lib/redis";
import { GEMINI_MODEL_ID } from "@/lib/gemini-config";
import { buildPrompt } from "@/lib/gemini-briefing-api";
import type { EvidencePacket, StructuredBriefing } from "@/lib/gemini-briefing-api";

// 같은 조건이면 1시간 안에는 Gemini를 다시 부르지 않고 이 값을 그대로 쓴다.
const BRIEFING_CACHE_TTL_SECONDS = 60 * 60;

// 캐시 키는 (모델, 근거+프롬프트)를 함께 담아야 조건이 하나라도 바뀌면
// 자동으로 새 키가 된다.
// - buildPrompt(facts)의 결과 문자열에는 근거(facts)와 브리핑 생성 규칙
//   문구가 그대로 들어있다 — 근거가 바뀌거나 규칙 문구를 고치면 이 문자열도
//   달라져 해시가 자동으로 달라진다.
// - 모델 ID는 별도로 더한다 — 같은 프롬프트라도 모델이 바뀌면 결과가
//   달라질 수 있기 때문이다.
// 이 키는 내용을 그대로 반영한 값(content-addressed)이라, 배포나 일반적인
// 코드 수정만으로는 바뀌지 않는다 — 그래서 배포할 때 Redis 캐시를 통째로
// 지울 필요가 없다. 위 세 조건 중 하나가 실제로 바뀌었을 때만 자연히 새
// 키가 되고, 더는 쓰이지 않는 이전 키는 TTL이 지나며 스스로 사라진다.
function buildCacheKey(code: string, packet: EvidencePacket): string {
  // generatedAt은 요청 시각이라 매번 달라진다. 근거가 같은 요청의 캐시를
  // 재사용할 수 있도록 키에서는 생성 시각만 제외한다.
  const identity = `${GEMINI_MODEL_ID}\n${buildPrompt({ ...packet, generatedAt: "" })}`;
  const hash = crypto.createHash("sha256").update(identity).digest("hex");
  return `briefing:${code}:${hash}`;
}

function logCacheWarning(action: string, err: unknown): void {
  console.warn(
    `Upstash Redis 캐시 ${action} 중 문제가 있어 건너뜁니다:`,
    toSafeRedisError(err).message
  );
}

// Redis에 접속할 수 없어도 캐시는 최적화일 뿐이다 — Gemini를 직접 불러
// 항상 정상 동작해야 한다.
export async function getCachedBriefing(
  code: string,
  packet: EvidencePacket
): Promise<StructuredBriefing | undefined> {
  if (!isUpstashConfigured()) return undefined;

  try {
    const cached = await getRedis().get<StructuredBriefing>(buildCacheKey(code, packet));
    return cached ?? undefined;
  } catch (err) {
    logCacheWarning("읽기", err);
    return undefined;
  }
}

// 검증까지 통과한 결과만 캐시한다 — 실패나 오류는 캐시하지 않아 다음
// 요청이 다시 시도할 수 있게 둔다.
export async function setCachedBriefing(
  code: string,
  packet: EvidencePacket,
  briefing: StructuredBriefing
): Promise<void> {
  if (!isUpstashConfigured()) return;

  try {
    await getRedis().set(buildCacheKey(code, packet), briefing, {
      ex: BRIEFING_CACHE_TTL_SECONDS,
    });
  } catch (err) {
    logCacheWarning("쓰기", err);
  }
}
