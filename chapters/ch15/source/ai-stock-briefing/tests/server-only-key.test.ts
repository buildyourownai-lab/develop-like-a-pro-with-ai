import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { redactSecret } from "../src/lib/redact";
import { toSafeRedisError } from "../src/lib/redis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function stripQuotes(value: string): string {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? value.slice(1, -1) : value;
}

function readEnvLocalValue(key: string): string {
  const envPath = path.join(projectRoot, ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
  if (!line) {
    throw new Error(`${key} 값을 .env.local에서 찾지 못했습니다.`);
  }
  return stripQuotes(line.slice(key.length + 1).trim());
}

function hasEnvLocalValue(key: string): boolean {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return false;
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
  return line !== undefined && stripQuotes(line.slice(key.length + 1).trim()).length > 0;
}

function collectClientBundleFiles(): string[] {
  const staticDir = path.join(projectRoot, ".next", "static");
  const files: string[] = [];
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  }
  walk(staticDir);
  return files;
}

// SUPABASE_DATABASE_URL·UPSTASH_REDIS_REST_URL·UPSTASH_REDIS_REST_TOKEN은
// /setup 화면에서 사용자가 직접 넣기 전에는 .env.local에 없을 수 있다.
// 그런 값은 검사에서 빼고, 실제로 채워진 뒤 다시 테스트를 돌리면 그 값도
// 함께 검사된다.
const SECRET_ENV_KEYS = [
  "DATA_GO_KR_SERVICE_KEY",
  "GEMINI_API_KEY",
  "OPEN_DART_API_KEY",
  "SUPABASE_DATABASE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
];

describe("인증키가 브라우저로 내려가지 않는다", () => {
  it("서버 전용 모듈에는 server-only 가드가 있다", () => {
    for (const file of [
      "server-env.ts",
      "fsc-api.ts",
      "dart-corp-code.ts",
      "dart-disclosure-api.ts",
      "db.ts",
      "redis.ts",
      "briefing-cache.ts",
    ]) {
      const src = fs.readFileSync(
        path.join(projectRoot, "src", "lib", file),
        "utf8"
      );
      expect(src.startsWith('import "server-only"')).toBe(true);
    }
  });

  it("빌드된 클라이언트 자바스크립트에 인증키 값이 포함되지 않는다", () => {
    const files = collectClientBundleFiles();
    expect(files.length).toBeGreaterThan(0);

    const presentKeys = SECRET_ENV_KEYS.filter(hasEnvLocalValue);
    for (const envKey of presentKeys) {
      const key = readEnvLocalValue(envKey);
      expect(key.length).toBeGreaterThan(0);

      for (const file of files) {
        const content = fs.readFileSync(file, "utf8");
        expect(content.includes(key)).toBe(false);
      }
    }
  });

  it("빌드된 클라이언트 자바스크립트에 인증키 변수 이름도 노출되지 않는다", () => {
    const files = collectClientBundleFiles();
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const envKey of SECRET_ENV_KEYS) {
        expect(content.includes(envKey)).toBe(false);
      }
    }
  });
});

describe("오류 메시지에 값이 그대로 실리지 않는다", () => {
  it("redactSecret이 비밀 값을 지운다", () => {
    const secret = "postgres://user:s3cr3t@example.supabase.co/postgres";
    const message = `connect ETIMEDOUT ${secret}`;
    expect(redactSecret(message, secret)).toBe("connect ETIMEDOUT [REDACTED]");
    expect(redactSecret(message, secret)).not.toContain(secret);
  });

  it("비밀 값이 없으면(undefined) 원문을 그대로 둔다", () => {
    const message = "SUPABASE_DATABASE_URL이 설정되지 않았습니다.";
    expect(redactSecret(message, undefined)).toBe(message);
  });

  it("toSafeRedisError가 URL과 토큰을 모두 지운다", () => {
    const originalUrl = process.env.UPSTASH_REDIS_REST_URL;
    const originalToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const url = "https://fake-instance.upstash.io";
    const token = "AaBbCc-fake-token-1234";
    process.env.UPSTASH_REDIS_REST_URL = url;
    process.env.UPSTASH_REDIS_REST_TOKEN = token;
    try {
      const err = new Error(`fetch failed: ${url} 401 ${token}`);
      const safe = toSafeRedisError(err);
      expect(safe.message).not.toContain(url);
      expect(safe.message).not.toContain(token);
    } finally {
      if (originalUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = originalUrl;
      if (originalToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = originalToken;
    }
  });
});
