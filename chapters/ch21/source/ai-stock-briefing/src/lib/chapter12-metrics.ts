import { AsyncLocalStorage } from "node:async_hooks";

export type Chapter12RunOptions = {
  databaseEnabled: boolean;
  redisEnabled: boolean;
  bypassNextCache: boolean;
  namespace: string;
  redisTtlSeconds?: number;
  databaseTtlSeconds?: number;
};

export type Chapter12MetricEvent = {
  service: "fsc" | "dart" | "gemini" | "supabase" | "redis" | "server";
  operation: string;
  durationMs: number;
  outcome?: "hit" | "miss" | "write" | "network" | "error";
  inputTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  totalTokens?: number;
};

export type Chapter12Metrics = {
  totalMs: number;
  events: Chapter12MetricEvent[];
  networkCalls: { fsc: number; dart: number; gemini: number; supabase: number; redis: number };
  geminiTokens: {
    input: number;
    output: number;
    thoughts: number;
    billableOutput: number;
    total: number;
  };
  supabase: { hits: number; misses: number; writes: number };
  redis: { hits: number; misses: number; writes: number };
};

type RunState = Chapter12RunOptions & { events: Chapter12MetricEvent[] };

export class Chapter12MeasuredError extends Error {
  constructor(
    readonly metrics: Chapter12Metrics,
    options: ErrorOptions
  ) {
    super("12장 측정 작업이 실패했습니다.", options);
    this.name = "Chapter12MeasuredError";
  }
}

const storage = new AsyncLocalStorage<RunState>();

export function chapter12Options(): Chapter12RunOptions {
  const state = storage.getStore();
  if (state) return state;
  const databaseUrl = process.env.SUPABASE_DATABASE_URL;
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  return {
    databaseEnabled: Boolean(databaseUrl?.trim()),
    redisEnabled: Boolean(redisUrl?.trim().match(/^https:\/\//i) && redisToken?.trim()),
    bypassNextCache: false,
    namespace: "production",
  };
}

export function recordChapter12Metric(event: Chapter12MetricEvent): void {
  storage.getStore()?.events.push(event);
}

function summarize(events: Chapter12MetricEvent[], totalMs: number): Chapter12Metrics {
  const count = (service: Chapter12MetricEvent["service"], outcome?: Chapter12MetricEvent["outcome"]) =>
    events.filter((event) => event.service === service && (!outcome || event.outcome === outcome)).length;
  const tokenSum = (field: "inputTokens" | "outputTokens" | "thoughtTokens" | "totalTokens") =>
    events.reduce((sum, event) => sum + (event[field] ?? 0), 0);
  const input = tokenSum("inputTokens");
  const output = tokenSum("outputTokens");
  const thoughts = tokenSum("thoughtTokens");
  const reportedTotal = tokenSum("totalTokens");
  return {
    totalMs,
    events,
    networkCalls: {
      fsc: count("fsc", "network"),
      dart: count("dart", "network"),
      gemini: count("gemini", "network"),
      supabase: count("supabase"),
      redis: count("redis"),
    },
    geminiTokens: {
      input,
      output,
      thoughts,
      billableOutput: output + thoughts,
      total: reportedTotal || input + output + thoughts,
    },
    supabase: {
      hits: count("supabase", "hit"),
      misses: count("supabase", "miss"),
      writes: count("supabase", "write"),
    },
    redis: {
      hits: count("redis", "hit"),
      misses: count("redis", "miss"),
      writes: count("redis", "write"),
    },
  };
}

export async function withChapter12Metrics<T>(
  options: Chapter12RunOptions,
  work: () => Promise<T>
): Promise<{ value: T; metrics: Chapter12Metrics }> {
  const state: RunState = { ...options, events: [] };
  const started = performance.now();
  try {
    const value = await storage.run(state, work);
    return { value, metrics: summarize(state.events, performance.now() - started) };
  } catch (cause) {
    throw new Chapter12MeasuredError(
      summarize(state.events, performance.now() - started),
      { cause }
    );
  }
}
