import "server-only";
import { Redis } from "@upstash/redis";
import {
  getUpstashRedisRestUrl,
  getUpstashRedisRestToken,
  isUpstashRedisConfigured,
  redactUpstashRedisSecrets,
} from "@/lib/server-env";

declare global {
  var __upstashRedis: Redis | undefined;
}

function createClient(): Redis {
  return new Redis({
    url: getUpstashRedisRestUrl(),
    token: getUpstashRedisRestToken(),
  });
}

// next dev의 Fast Refresh로 이 모듈이 다시 로드돼도 클라이언트를 하나만
// 유지한다 (Supabase 쪽 db.ts와 같은 이유).
export function getRedis(): Redis {
  if (!globalThis.__upstashRedis) {
    globalThis.__upstashRedis = createClient();
  }
  return globalThis.__upstashRedis;
}

export function isUpstashConfigured(): boolean {
  return isUpstashRedisConfigured();
}

// URL과 토큰이 예외 메시지에 그대로 실리는 경로를 막는다.
export function toSafeRedisError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactUpstashRedisSecrets(message));
}
