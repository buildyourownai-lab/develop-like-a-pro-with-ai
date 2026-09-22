import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const host = "127.0.0.1";
const port = 3212;
const remoteBaseUrl = process.env.CHAPTER12_BASE_URL?.trim().replace(/\/$/, "");
const baseUrl = remoteBaseUrl || `http://${host}:${port}`;
const token = process.env.CHAPTER12_MEASUREMENT_TOKEN?.trim() || randomBytes(24).toString("hex");
const runId = Date.now();
const databaseNamespace = `measure-db-${runId}`;
const cacheNamespace = `measure-cache-${runId}`;
const repeat = 5;
const freeTierGeminiSpacingMs = 13_000;
const measurementStartedAt = new Date().toISOString();
const failures = [];
const completedRequests = [];

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function summarize(runs) {
  const e2eDurations = runs.map((run) => run.e2eMs);
  const internalDurations = runs.map((run) => run.metrics.totalMs);
  const sum = (read) => runs.reduce((total, run) => total + read(run.metrics), 0);
  const eventSummary = new Map();
  for (const run of runs) {
    for (const event of run.metrics.events) {
      const key = `${event.service}:${event.operation}`;
      const current = eventSummary.get(key) ?? { service: event.service, operation: event.operation, count: 0, totalMs: 0 };
      current.count += 1;
      current.totalMs += event.durationMs;
      eventSummary.set(key, current);
    }
  }
  return {
    runs: runs.length,
    e2e: {
      totalMs: e2eDurations.reduce((total, value) => total + value, 0),
      averageMs: e2eDurations.reduce((total, value) => total + value, 0) / runs.length,
      p50Ms: percentile(e2eDurations, 50),
      p95Ms: percentile(e2eDurations, 95),
      individualMs: e2eDurations,
    },
    internal: {
      totalMs: internalDurations.reduce((total, value) => total + value, 0),
      averageMs: internalDurations.reduce((total, value) => total + value, 0) / runs.length,
      p50Ms: percentile(internalDurations, 50),
      p95Ms: percentile(internalDurations, 95),
      individualMs: internalDurations,
    },
    httpStatuses: runs.map((run) => run.httpStatus),
    vercelRegions: [...new Set(runs.map((run) => run.runtime?.vercelRegion).filter(Boolean))],
    networkCalls: {
      fsc: sum((run) => run.networkCalls.fsc),
      dart: sum((run) => run.networkCalls.dart),
      gemini: sum((run) => run.networkCalls.gemini),
    },
    geminiTokens: {
      input: sum((run) => run.geminiTokens.input),
      output: sum((run) => run.geminiTokens.output),
      thoughts: sum((run) => run.geminiTokens.thoughts),
      billableOutput: sum((run) => run.geminiTokens.billableOutput),
      total: sum((run) => run.geminiTokens.total),
    },
    supabase: {
      reads: sum((run) => run.supabase.hits + run.supabase.misses),
      hits: sum((run) => run.supabase.hits),
      misses: sum((run) => run.supabase.misses),
      writes: sum((run) => run.supabase.writes),
    },
    redis: {
      hits: sum((run) => run.redis.hits),
      misses: sum((run) => run.redis.misses),
      writes: sum((run) => run.redis.writes),
    },
    eventSummary: [...eventSummary.values()].map((event) => ({
      ...event,
      averageMs: event.totalMs / event.count,
    })),
    raw: runs,
  };
}

function reduction(before, after) {
  return before === 0 ? null : (1 - after / before) * 100;
}

function responseImprovement(before, after) {
  return {
    milliseconds: before - after,
    seconds: (before - after) / 1_000,
    percent: reduction(before, after),
    speedup: after === 0 ? null : before / after,
  };
}

function estimatedCost(inputTokens, billableOutputTokens) {
  return (inputTokens / 1_000_000) * 0.30 + (billableOutputTokens / 1_000_000) * 2.50;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/chapter12/measure/000660`, { method: "GET" });
      if (response.status) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("측정 서버가 시작되지 않았습니다.");
}

async function callMeasurement(experiment, profile, namespace, options = {}) {
  const requestedAt = new Date().toISOString();
  try {
    const e2eStarted = performance.now();
    const response = await fetch(`${baseUrl}/api/chapter12/measure/000660`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-chapter12-measurement-token": token },
      body: JSON.stringify({ experiment, profile, namespace, ...options }),
      signal: AbortSignal.timeout(180_000),
    });
    const responseText = await response.text();
    const e2eMs = performance.now() - e2eStarted;
    const payload = JSON.parse(responseText);
    if (!response.ok) {
      throw new Error(
        [payload.error ?? `측정 요청 실패: ${response.status}`, ...(payload.diagnostic ?? [])].join(" | ")
      );
    }
    const completed = {
      requestedAt,
      experiment,
      profile,
      options,
      e2eMs,
      httpStatus: response.status,
      runtime: payload.runtime ?? null,
      value: payload.value,
      metrics: payload.metrics,
    };
    completedRequests.push(completed);
    return completed;
  } catch (error) {
    failures.push({
      requestedAt,
      experiment,
      profile,
      options,
      error: redact(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
}

async function measure(experiment, profile, namespace, options = {}) {
  return callMeasurement(experiment, profile, namespace, options);
}

function redact(value) {
  return value
    .replace(/\b(?:postgres(?:ql)?|rediss?):\/\/[^\s|]+/gi, "[redacted-connection-url]")
    .replace(/\bhttps?:\/\/[^\s|]*[?&](?:key|token|serviceKey)=[^&\s|]+/gi, "[redacted-url]")
    .replace(/authorization\s*[:=]\s*[^\s|]+/gi, "authorization=[redacted]")
    .replace(/AIza[A-Za-z0-9_-]+/g, "[redacted]");
}

async function repeatMeasure(experiment, profile, namespace, spacingMs = 0, count = repeat, options = {}) {
  const runs = [];
  for (let index = 0; index < count; index += 1) {
    runs.push(await measure(experiment, profile, namespace, options));
    if (spacingMs > 0) await new Promise((resolve) => setTimeout(resolve, spacingMs));
  }
  return runs;
}

function assertMeasurement(condition, message) {
  if (!condition) throw new Error(`측정 조건 불일치: ${message}`);
}

const server = remoteBaseUrl
  ? null
  : spawn("npm", ["run", "start", "--", "--hostname", host, "--port", String(port)], {
      cwd: process.cwd(),
      env: { ...process.env, CHAPTER12_MEASUREMENT_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
server?.stdout.on("data", (chunk) => process.stdout.write(chunk));
server?.stderr.on("data", (chunk) => process.stderr.write(chunk));

try {
  await waitForServer();

  // Database 실험: 금융위원회 직접 조회 5회 → 최초 저장 1회 → Supabase 재조회 5회.
  const databaseBaselineRuns = await repeatMeasure("database", "baseline", databaseNamespace);
  const databaseLoadRuns = [await measure("database", "after", databaseNamespace)];
  const databaseWarmRuns = await repeatMeasure("database", "after", databaseNamespace);
  const databaseBaseline = summarize(databaseBaselineRuns);
  const databaseLoad = summarize(databaseLoadRuns);
  const databaseWarm = summarize(databaseWarmRuns);

  assertMeasurement(databaseBaseline.networkCalls.fsc > 0, "Database Baseline에서 금융위원회 호출이 없다.");
  assertMeasurement(databaseLoad.supabase.writes > 0, "Database Load에서 Supabase 저장이 없다.");
  assertMeasurement(databaseWarm.supabase.hits > 0, "Database Warm에서 Supabase 조회 성공이 없다.");
  assertMeasurement(databaseWarm.networkCalls.fsc === 0, "Database Warm에서 금융위원회가 다시 호출됐다.");

  // Cache 실험용 Evidence는 한 번만 준비하고 모든 Baseline/Cold/Warm 요청에서 그대로 사용한다.
  // 준비 과정의 금융위원회·OpenDART 시간과 호출은 Cache 비교값에서 제외한다.
  const evidencePreparationResponse = await callMeasurement(
    "cache",
    "baseline",
    cacheNamespace,
    { prepareEvidence: true }
  );
  assertMeasurement(
    evidencePreparationResponse.value?.model === "gemini-3.5-flash-lite",
    "Production Gemini 모델이 gemini-3.5-flash-lite가 아니다."
  );
  const evidencePreparation = summarize([evidencePreparationResponse]);
  const fixedEvidence = evidencePreparationResponse.value.packet;
  const cacheBaselineRuns = await repeatMeasure(
    "cache", "baseline", cacheNamespace, freeTierGeminiSpacingMs, repeat, { evidence: fixedEvidence }
  );
  const cacheColdRuns = [await measure("cache", "after", cacheNamespace, { evidence: fixedEvidence })];
  const cacheWarmRuns = await repeatMeasure(
    "cache", "after", cacheNamespace, 0, repeat, { evidence: fixedEvidence }
  );
  const cacheBaseline = summarize(cacheBaselineRuns);
  const cacheCold = summarize(cacheColdRuns);
  const cacheWarm = summarize(cacheWarmRuns);

  assertMeasurement(cacheBaseline.networkCalls.gemini === repeat, "Cache Baseline의 Gemini 호출 횟수가 계획과 다르다.");
  assertMeasurement(cacheCold.networkCalls.gemini === 1, "Cache Cold의 Gemini 호출이 1회가 아니다.");
  assertMeasurement(cacheCold.redis.misses === 1, "Cache Cold가 Redis MISS가 아니다.");
  assertMeasurement(cacheCold.redis.writes === 1, "Cache Cold에서 Redis 저장 성공을 확인하지 못했다.");
  assertMeasurement(cacheWarm.networkCalls.gemini === 0, "Cache Warm에서 Gemini가 호출됐다.");
  assertMeasurement(cacheWarm.redis.hits === repeat, "Cache Warm의 Redis HIT가 5회가 아니다.");
  assertMeasurement(cacheWarm.geminiTokens.total === 0, "Cache Warm에서 Gemini Token이 사용됐다.");
  const coldBriefing = JSON.stringify(cacheColdRuns[0].value?.briefing ?? null);
  assertMeasurement(
    cacheWarmRuns.every((run) => JSON.stringify(run.value?.briefing ?? null) === coldBriefing),
    "Cache Warm이 Cold와 같은 브리핑을 반환하지 않았다."
  );
  assertMeasurement(
    [...databaseBaselineRuns, ...databaseLoadRuns, ...databaseWarmRuns, evidencePreparationResponse,
      ...cacheBaselineRuns, ...cacheColdRuns, ...cacheWarmRuns]
      .every((run) => run.httpStatus === 200 && run.runtime?.vercelRegion === "icn1"),
    "모든 요청이 HTTP 200 및 Vercel icn1에서 처리되지 않았다."
  );

  const databaseImprovement = {
    e2eResponseTime: responseImprovement(databaseBaseline.e2e.averageMs, databaseWarm.e2e.averageMs),
    internalResponseTime: responseImprovement(databaseBaseline.internal.averageMs, databaseWarm.internal.averageMs),
    fscCalls: {
      before: databaseBaseline.networkCalls.fsc,
      after: databaseWarm.networkCalls.fsc,
      decreasedBy: databaseBaseline.networkCalls.fsc - databaseWarm.networkCalls.fsc,
      percent: reduction(databaseBaseline.networkCalls.fsc, databaseWarm.networkCalls.fsc),
    },
  };
  const cacheImprovement = {
    e2eResponseTime: responseImprovement(cacheBaseline.e2e.averageMs, cacheWarm.e2e.averageMs),
    internalResponseTime: responseImprovement(cacheBaseline.internal.averageMs, cacheWarm.internal.averageMs),
    geminiCalls: {
      before: cacheBaseline.networkCalls.gemini,
      after: cacheWarm.networkCalls.gemini,
      decreasedBy: cacheBaseline.networkCalls.gemini - cacheWarm.networkCalls.gemini,
      percent: reduction(cacheBaseline.networkCalls.gemini, cacheWarm.networkCalls.gemini),
    },
    geminiTokens: {
      input: {
        before: cacheBaseline.geminiTokens.input,
        after: cacheWarm.geminiTokens.input,
        decreasedBy: cacheBaseline.geminiTokens.input - cacheWarm.geminiTokens.input,
        percent: reduction(cacheBaseline.geminiTokens.input, cacheWarm.geminiTokens.input),
      },
      output: {
        before: cacheBaseline.geminiTokens.output,
        after: cacheWarm.geminiTokens.output,
        decreasedBy: cacheBaseline.geminiTokens.output - cacheWarm.geminiTokens.output,
        percent: reduction(cacheBaseline.geminiTokens.output, cacheWarm.geminiTokens.output),
      },
      thoughts: {
        before: cacheBaseline.geminiTokens.thoughts,
        after: cacheWarm.geminiTokens.thoughts,
        decreasedBy: cacheBaseline.geminiTokens.thoughts - cacheWarm.geminiTokens.thoughts,
        percent: reduction(cacheBaseline.geminiTokens.thoughts, cacheWarm.geminiTokens.thoughts),
      },
      total: {
        before: cacheBaseline.geminiTokens.total,
        after: cacheWarm.geminiTokens.total,
        decreasedBy: cacheBaseline.geminiTokens.total - cacheWarm.geminiTokens.total,
        percent: reduction(cacheBaseline.geminiTokens.total, cacheWarm.geminiTokens.total),
      },
    },
  };

  const baselinePerRequest = {
    input: cacheBaseline.geminiTokens.input / cacheBaseline.runs,
    billableOutput: cacheBaseline.geminiTokens.billableOutput / cacheBaseline.runs,
  };
  const coldTokens = cacheCold.geminiTokens;
  const projectedCosts = [100, 1_000, 10_000].map((requests) => {
    const before = estimatedCost(
      baselinePerRequest.input * requests,
      baselinePerRequest.billableOutput * requests
    );
    // 동일 Evidence 반복 요청은 최초 Cold 1회의 Gemini Token만 사용하고 나머지는 Redis HIT라고 가정한다.
    const after = estimatedCost(coldTokens.input, coldTokens.billableOutput);
    return {
      requests,
      beforeUsd: before,
      afterUsd: after,
      savedUsd: before - after,
      savedPercent: reduction(before, after),
    };
  });

  const result = {
    measurementStartedAt,
    measuredAt: new Date().toISOString(),
    scenario: "SK하이닉스(000660), 동일 데이터·동일 Evidence, 각 비교 구간 5회",
    reproducibility: {
      environment: remoteBaseUrl ? "Vercel production deployment" : "local production build",
      baseUrl,
      stockCode: "000660",
      geminiModel: evidencePreparationResponse.value.model,
      evidence: evidencePreparationResponse.value.evidence,
      repeat,
      supabaseState: "Load 저장 후 Warm 5회 재조회",
      redisState: "Cold 전 빈 namespace, Cold 저장 후 Warm 5회 HIT",
      failures,
    },
    controls: {
      repeat,
      nextFetchCacheBypassed: true,
      databaseLoadExcludedFromWarm: true,
      evidencePreparationExcludedFromCacheComparison: true,
      cacheColdExcludedFromWarm: true,
      expectedGeminiCalls: {
        baseline: repeat,
        coldThisRun: 1,
        warm: 0,
        total: repeat + 1,
      },
      freeTierGeminiSpacingMs,
      geminiAutomaticRetry: false,
      databaseNamespace,
      cacheNamespace,
    },
    pricing: {
      basis: "Gemini 3.5 Flash-Lite standard paid tier, official price checked 2026-08-21",
      officialSource: "https://ai.google.dev/gemini-api/docs/pricing",
      inputUsdPerMillionTokens: 0.30,
      outputUsdPerMillionTokens: 2.50,
      note: "실제 Free Tier 과금액이 아니라 실제 Token 측정값을 공식 유료 단가로 계산한 추정치",
      outputTokenRule: "visible output + thought tokens를 유료 output 단가에 적용",
    },
    databaseExperiment: {
      baseline: databaseBaseline,
      load: databaseLoad,
      warm: databaseWarm,
      improvement: databaseImprovement,
    },
    cacheExperiment: {
      evidencePreparation,
      baseline: cacheBaseline,
      cold: {
        ...cacheCold,
        geminiCalled: cacheCold.networkCalls.gemini === 1,
        redisMiss: cacheCold.redis.misses === 1,
        cacheWriteSucceeded: cacheCold.redis.writes === 1,
      },
      warm: cacheWarm,
      improvement: cacheImprovement,
      projectedCosts,
    },
  };
  const directory = join(process.cwd(), "verification", "chapter-12");
  await mkdir(directory, { recursive: true });
  const artifactId = new Date().toISOString().replace(/[:.]/g, "-");
  await Promise.all([
    writeFile(join(directory, `production-e2e-icn1-${artifactId}.json`), `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    writeFile(join(directory, `database-timing-icn1-${artifactId}.json`), `${JSON.stringify({
      measurementStartedAt,
      measuredAt: result.measuredAt,
      namespace: databaseNamespace,
      experiment: result.databaseExperiment,
    }, null, 2)}\n`, "utf8"),
    writeFile(join(directory, `cache-timing-icn1-${artifactId}.json`), `${JSON.stringify({
      measurementStartedAt,
      measuredAt: result.measuredAt,
      namespace: cacheNamespace,
      experiment: result.cacheExperiment,
    }, null, 2)}\n`, "utf8"),
  ]);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  const directory = join(process.cwd(), "verification", "chapter-12");
  await mkdir(directory, { recursive: true });
  const artifactId = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(
    join(directory, `production-e2e-icn1-failed-${artifactId}.json`),
    `${JSON.stringify({
      measurementStartedAt,
      failedAt: new Date().toISOString(),
      completedRequests,
      failures,
    }, null, 2)}\n`,
    "utf8"
  );
  throw error;
} finally {
  server?.kill("SIGTERM");
}
