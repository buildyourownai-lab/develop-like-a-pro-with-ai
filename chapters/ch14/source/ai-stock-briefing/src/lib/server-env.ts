import "server-only";
import { redactSecret } from "@/lib/redact";

export function getDataGoKrServiceKey(): string {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    throw new Error(
      "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}

export function getOpenDartApiKey(): string {
  const key = process.env.OPEN_DART_API_KEY;
  if (!key) {
    throw new Error(
      "OPEN_DART_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}

// 로컬과 배포 환경에서 같은 환경변수 이름을 사용한다.
function getSupabaseDatabaseUrlIfSet(): string | undefined {
  return process.env.SUPABASE_DATABASE_URL;
}

function getUpstashRedisRestUrlIfSet(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_URL;
}

function getUpstashRedisRestTokenIfSet(): string | undefined {
  return process.env.UPSTASH_REDIS_REST_TOKEN;
}

export function getSupabaseDatabaseUrl(): string {
  const url = getSupabaseDatabaseUrlIfSet();
  if (!url) {
    throw new Error(
      "SUPABASE_DATABASE_URL이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return url;
}

export function isSupabaseDatabaseConfigured(): boolean {
  return Boolean(getSupabaseDatabaseUrlIfSet());
}

export function redactSupabaseDatabaseUrl(message: string): string {
  return redactSecret(message, getSupabaseDatabaseUrlIfSet());
}

export function getUpstashRedisRestUrl(): string {
  const url = getUpstashRedisRestUrlIfSet();
  if (!url) {
    throw new Error(
      "UPSTASH_REDIS_REST_URL이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return url;
}

export function getUpstashRedisRestToken(): string {
  const token = getUpstashRedisRestTokenIfSet();
  if (!token) {
    throw new Error(
      "UPSTASH_REDIS_REST_TOKEN이 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return token;
}

export function isUpstashRedisConfigured(): boolean {
  return Boolean(
    getUpstashRedisRestUrlIfSet() && getUpstashRedisRestTokenIfSet()
  );
}

export function redactUpstashRedisSecrets(message: string): string {
  const withoutToken = redactSecret(message, getUpstashRedisRestTokenIfSet());
  return redactSecret(withoutToken, getUpstashRedisRestUrlIfSet());
}
