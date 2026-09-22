import { getRedis, toSafeRedisError } from "../src/lib/redis";
import { loadEnvLocal } from "./env-local";

const TEST_KEY = "chapter12:connection-check";

async function main() {
  loadEnvLocal();

  console.log("Upstash Redis 연결 확인 중... (URL·토큰 값은 출력하지 않음)");

  const redis = getRedis();
  const marker = `ok-${Date.now()}`;
  await redis.set(TEST_KEY, marker, { ex: 30 });
  const readBack = await redis.get<string>(TEST_KEY);
  await redis.del(TEST_KEY);

  if (readBack !== marker) {
    throw new Error("쓴 값과 읽은 값이 달라 연결을 확인하지 못했습니다.");
  }
  console.log("연결 성공 · 쓰기/읽기/지우기 모두 정상 동작했습니다.");
}

main().catch((err) => {
  console.error("오류 발생:", toSafeRedisError(err).message);
  process.exitCode = 1;
});
