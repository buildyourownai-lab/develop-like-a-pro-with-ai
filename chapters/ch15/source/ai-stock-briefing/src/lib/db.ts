import "server-only";
import postgres from "postgres";
import {
  getSupabaseDatabaseUrl,
  redactSupabaseDatabaseUrl,
} from "@/lib/server-env";

declare global {
  var __supabaseSql: ReturnType<typeof postgres> | undefined;
}

function createClient(): ReturnType<typeof postgres> {
  const connectionString = getSupabaseDatabaseUrl();
  return postgres(connectionString, {
    ssl: "require",
    // Supabase의 트랜잭션 풀러(pgbouncer)는 준비된 문장(prepared statement)을
    // 지원하지 않는다.
    prepare: false,
    onnotice: () => {},
  });
}

// next dev의 Fast Refresh로 이 모듈이 다시 로드될 때마다 연결을 새로 만들면
// 연결이 계속 쌓이므로, globalThis에 붙여 개발 중에도 하나만 유지한다.
export function getDb(): ReturnType<typeof postgres> {
  if (!globalThis.__supabaseSql) {
    globalThis.__supabaseSql = createClient();
  }
  return globalThis.__supabaseSql;
}

// 연결 문자열이 예외 메시지에 그대로 실리는 경로를 막는다 — DB 접속 자체가
// 실패했을 때(주소를 못 찾거나 인증이 거부되는 경우 등) 호출한다.
export function toSafeDbError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(redactSupabaseDatabaseUrl(message));
}
