import "server-only";
import type postgres from "postgres";
import { getDb, toSafeDbError } from "@/lib/db";
import { isSupabaseDatabaseConfigured } from "@/lib/server-env";

export const CACHE_TTL_SECONDS = {
  // 최신 거래 기준일을 찾은 결과 — 장중에는 "오늘 데이터가 아직 없다"는
  // 판단이 곧 뒤집힐 수 있어 짧게 둔다.
  latestTradingDate: 60 * 60,
  // 기준일이 확정된 뒤의 주식 시세·최근 1년 차트·시장 지수·상장종목 정보 —
  // 이미 지난 거래일의 값은 더 이상 바뀌지 않는다.
  confirmedMarketData: 24 * 60 * 60,
} as const;

let tableReady: Promise<void> | undefined;

async function createTable(): Promise<void> {
  const sql = getDb();
  await sql`
    create table if not exists api_cache (
      cache_key text primary key,
      payload jsonb not null,
      expires_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `;
  await sql`
    create index if not exists api_cache_expires_at_idx
      on api_cache (expires_at)
  `;
}

function getTableReady(): Promise<void> {
  if (!tableReady) {
    // 테이블 생성이 실패하면 다음 호출에서 다시 시도할 수 있게 캐시를 비운다.
    tableReady = createTable().catch((err) => {
      tableReady = undefined;
      throw err;
    });
  }
  return tableReady;
}

async function readCache<T>(key: string): Promise<T | undefined> {
  const sql = getDb();
  const rows = await sql<{ payload: T }[]>`
    select payload from api_cache
    where cache_key = ${key} and expires_at > now()
    limit 1
  `;
  return rows[0]?.payload;
}

async function writeCache<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  const sql = getDb();
  await sql`
    insert into api_cache (cache_key, payload, expires_at)
    values (
      ${key},
      ${sql.json(value as unknown as postgres.JSONValue)},
      now() + interval '1 second' * ${ttlSeconds}
    )
    on conflict (cache_key) do update
      set payload = excluded.payload,
          expires_at = excluded.expires_at,
          created_at = now()
  `;
}

// 만료된 캐시만 지운다 — 아직 유효한 캐시나 다른 테이블은 건드리지 않는다.
export async function cleanupExpiredCache(): Promise<number> {
  const sql = getDb();
  const deleted = await sql`
    delete from api_cache where expires_at <= now() returning cache_key
  `;
  return deleted.length;
}

// 정리를 매번 부르는 대신, 쓸 때마다 낮은 확률로만 함께 청소해 별도의
// 배치 작업 없이도 만료된 행이 계속 쌓이지 않게 한다.
const CLEANUP_PROBABILITY = 0.02;

function logCacheWarning(action: string, err: unknown): void {
  console.warn(
    `Supabase 캐시 ${action} 중 문제가 있어 건너뜁니다:`,
    toSafeDbError(err).message
  );
}

// Supabase 캐시는 있으면 응답을 줄여주는 최적화일 뿐이다. SUPABASE_DATABASE_URL이
// 없거나 Supabase에 일시적으로 접속할 수 없어도 금융위원회 API를 직접 불러
// 항상 정상 동작해야 한다 — 캐시 문제로 화면이 깨지면 안 된다.
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>
): Promise<T> {
  if (!isSupabaseDatabaseConfigured()) {
    return compute();
  }

  try {
    await getTableReady();
    const cached = await readCache<T>(key);
    if (cached !== undefined) {
      return cached;
    }
  } catch (err) {
    logCacheWarning("읽기", err);
  }

  const fresh = await compute();

  try {
    await writeCache(key, fresh, ttlSeconds);
    if (Math.random() < CLEANUP_PROBABILITY) {
      await cleanupExpiredCache();
    }
  } catch (err) {
    logCacheWarning("쓰기", err);
  }

  return fresh;
}
