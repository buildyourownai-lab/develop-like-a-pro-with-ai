import { getDb, toSafeDbError } from "../src/lib/db";
import { loadEnvLocal } from "./env-local";

async function main() {
  loadEnvLocal();

  console.log("Supabase Database 연결 확인 중... (연결 문자열 값은 출력하지 않음)");

  const sql = getDb();
  try {
    const rows = await sql<{ now: string; db: string }[]>`
      select now()::text as now, current_database() as db
    `;
    console.log(`연결 성공 · DB: ${rows[0].db} · 서버 시간: ${rows[0].now}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("오류 발생:", toSafeDbError(err).message);
  process.exitCode = 1;
});
