import "server-only";

import postgres from "postgres";

import { chapter12Options, recordChapter12Metric } from "./chapter12-metrics";
import { fscRequestKey, stableFscParams } from "./fsc-request-key";

type StoredPage<T> = { items: T[]; totalCount: number };

let client: ReturnType<typeof postgres> | null = null;
let schemaReady: Promise<void> | null = null;

function databaseClient() {
  const url = (process.env.SUPABASE_DATABASE_URL)?.trim();
  if (!url) throw new Error("SUPABASE_DATABASE_URL이 준비되지 않았습니다.");
  client ??= postgres(url, {
    prepare: false,
    max: 3,
    connect_timeout: 15,
    idle_timeout: 20,
  });
  return client;
}

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const sql = databaseClient();
    await sql`
      create table if not exists public.chapter12_fsc_snapshots (
        namespace text not null,
        request_key text not null,
        endpoint text not null,
        request_params jsonb not null,
        payload jsonb not null,
        source_base_date text,
        fetched_at timestamptz not null,
        fresh_until timestamptz not null,
        primary key (namespace, request_key)
      )
    `;
    await sql`alter table public.chapter12_fsc_snapshots enable row level security`;
    await sql`
      create index if not exists chapter12_fsc_snapshots_fresh_until_idx
      on public.chapter12_fsc_snapshots (fresh_until)
    `;
  })().catch((error: unknown) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

export async function readFscSnapshot<T>(
  endpoint: string,
  params: Record<string, string | number>
): Promise<StoredPage<T> | null> {
  if (!chapter12Options().databaseEnabled) return null;
  const readyStarted = performance.now();
  await ensureSchema();
  recordChapter12Metric({
    service: "supabase",
    operation: "database-ready",
    durationMs: performance.now() - readyStarted,
  });
  const sql = databaseClient();
  const started = performance.now();
  const rows = await sql<{ payload: StoredPage<T> }[]>`
    select payload
    from public.chapter12_fsc_snapshots
    where namespace = ${chapter12Options().namespace}
      and request_key = ${fscRequestKey(endpoint, params)}
      and fresh_until > now()
    limit 1
  `;
  const hit = rows.length === 1;
  recordChapter12Metric({
    service: "supabase",
    operation: "read-fsc-snapshot",
    durationMs: performance.now() - started,
    outcome: hit ? "hit" : "miss",
  });
  return hit ? rows[0].payload : null;
}

export async function writeFscSnapshot<T>(options: {
  endpoint: string;
  params: Record<string, string | number>;
  payload: StoredPage<T>;
  ttlSeconds: number;
  sourceBaseDate?: string;
}): Promise<void> {
  if (!chapter12Options().databaseEnabled) return;
  const readyStarted = performance.now();
  await ensureSchema();
  recordChapter12Metric({
    service: "supabase",
    operation: "database-ready",
    durationMs: performance.now() - readyStarted,
  });
  const sql = databaseClient();
  const params = stableFscParams(options.params);
  const started = performance.now();
  await sql`
    insert into public.chapter12_fsc_snapshots (
      namespace, request_key, endpoint, request_params, payload,
      source_base_date, fetched_at, fresh_until
    ) values (
      ${chapter12Options().namespace},
      ${fscRequestKey(options.endpoint, params)},
      ${options.endpoint},
      ${sql.json(params)},
      ${sql.json(options.payload as unknown as postgres.JSONValue)},
      ${options.sourceBaseDate ?? null},
      now(),
      now() + (${options.ttlSeconds} * interval '1 second')
    )
    on conflict (namespace, request_key) do update set
      endpoint = excluded.endpoint,
      request_params = excluded.request_params,
      payload = excluded.payload,
      source_base_date = excluded.source_base_date,
      fetched_at = excluded.fetched_at,
      fresh_until = excluded.fresh_until
  `;
  recordChapter12Metric({
    service: "supabase",
    operation: "write-fsc-snapshot",
    durationMs: performance.now() - started,
    outcome: "write",
  });
}

export async function deleteFscSnapshots(namespace: string): Promise<void> {
  await ensureSchema();
  const sql = databaseClient();
  await sql`delete from public.chapter12_fsc_snapshots where namespace = ${namespace}`;
}
