import { cleanupExpiredCache } from "../src/lib/api-cache";
import { getDb, toSafeDbError } from "../src/lib/db";
import { loadEnvLocal } from "./env-local";

async function main() {
  loadEnvLocal();

  console.log("만료된 Supabase 캐시 정리 중...");
  const deletedCount = await cleanupExpiredCache();
  console.log(
    `만료된 캐시 ${deletedCount}건을 지웠습니다. 아직 유효한 캐시와 다른 테이블은 그대로 둡니다.`
  );
}

main()
  .catch((err) => {
    console.error("오류 발생:", toSafeDbError(err).message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDb().end({ timeout: 5 });
  });
