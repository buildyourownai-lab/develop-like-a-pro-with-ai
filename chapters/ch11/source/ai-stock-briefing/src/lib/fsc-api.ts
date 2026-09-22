import "server-only";

import https from "node:https";
import { getDataGoKrServiceKey } from "./server-env";

const NORMAL_RESULT_CODES = new Set(["00", "000"]);
const MAX_ATTEMPTS = 3;
const RETRYABLE_HTTP_STATUS = new Set([500, 502, 503, 504]);
const FSC_HOSTNAME = "apis.data.go.kr";
const USE_NATIVE_FSC_HTTPS = process.env.FSC_NATIVE_HTTPS === "1";
const fscHttpsAgent = new https.Agent({ family: 4, keepAlive: true, maxSockets: 1 });
let fscRequestTail: Promise<void> = Promise.resolve();

type FscPayload<T> = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: {
      totalCount?: number;
      items?: { item?: T | T[] } | "";
    };
  };
};

export type FscPage<T> = { totalCount: number; items: T[] };

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250 * attempt));
}

function nativeHttpsFetch(url: string): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { agent: fscHttpsAgent, timeout: 45_000 }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      incoming.on("end", () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: incoming.statusCode ?? 500,
          statusText: incoming.statusMessage,
          headers: Object.fromEntries(
            Object.entries(incoming.headers)
              .filter((entry): entry is [string, string | string[]] => entry[1] !== undefined)
              .map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])
          ),
        }));
      });
    });
    request.on("timeout", () => request.destroy(new DOMException("timeout", "TimeoutError")));
    request.on("error", reject);
  });
}

async function fetchWithStableTransport(url: string): Promise<Response> {
  // 일부 로컬 Node 환경에서 Undici 연결만 막힐 때 명시적으로 IPv4 HTTPS를 쓴다.
  // 기본 경로는 최종 프로젝트와 같은 표준 fetch다.
  if (USE_NATIVE_FSC_HTTPS && new URL(url).hostname === FSC_HOSTNAME) {
    return nativeHttpsFetch(url);
  }
  return fetch(url, { next: { revalidate: 600 }, signal: AbortSignal.timeout(45_000) });
}

function fetchFscInOrder(url: string): Promise<Response> {
  if (!USE_NATIVE_FSC_HTTPS) return fetchWithStableTransport(url);
  const request = fscRequestTail.then(
    () => fetchWithStableTransport(url),
    () => fetchWithStableTransport(url)
  );
  fscRequestTail = request.then(() => undefined, () => undefined);
  return request;
}

function serviceKeyValue(key: string): string {
  return key.includes("%") ? key : encodeURIComponent(key);
}

function describeNonJson(text: string): string {
  const reason = /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/.exec(text)?.[1];
  const message = /<errMsg>([^<]+)<\/errMsg>/.exec(text)?.[1];
  if (reason || message) {
    return `공공데이터포털이 오류를 반환했습니다: ${[message, reason].filter(Boolean).join(" / ")}`;
  }
  return "공공데이터포털 응답을 JSON으로 읽을 수 없습니다.";
}

function normalizeItems<T>(items: { item?: T | T[] } | "" | undefined): T[] {
  if (!items || typeof items !== "object" || !items.item) return [];
  return Array.isArray(items.item) ? items.item : [items.item];
}

export async function fetchFscPage<T>(
  endpoint: string,
  params: Record<string, string | number>,
  label: string
): Promise<FscPage<T>> {
  const query = new URLSearchParams({ resultType: "json" });
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  const url = `${endpoint}?serviceKey=${serviceKeyValue(getDataGoKrServiceKey())}&${query.toString()}`;

  let response: Response | null = null;
  let lastConnectionError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      response = await fetchFscInOrder(url);
      if (response.ok || !RETRYABLE_HTTP_STATUS.has(response.status) || attempt === MAX_ATTEMPTS) break;
    } catch (error) {
      lastConnectionError = error;
      if (attempt === MAX_ATTEMPTS) break;
    }
    await waitBeforeRetry(attempt);
  }
  if (!response) {
    if (lastConnectionError instanceof DOMException && lastConnectionError.name === "TimeoutError") {
      throw new Error(`${label} 요청 시간이 초과되었습니다.`);
    }
    throw new Error(`${label} 서버에 연결하지 못했습니다.`);
  }
  if (!response.ok) throw new Error(`${label} 요청이 실패했습니다. (HTTP ${response.status})`);

  const text = await response.text();
  let payload: FscPayload<T>;
  try {
    payload = JSON.parse(text) as FscPayload<T>;
  } catch {
    throw new Error(describeNonJson(text));
  }

  const resultCode = String(payload.response?.header?.resultCode ?? "");
  if (!NORMAL_RESULT_CODES.has(resultCode)) {
    const resultMsg = payload.response?.header?.resultMsg ?? "응답 형식을 확인할 수 없습니다";
    throw new Error(`${label} 응답이 정상이 아닙니다. (${resultCode || "코드 없음"}: ${resultMsg})`);
  }

  return {
    totalCount: Number(payload.response?.body?.totalCount ?? 0),
    items: normalizeItems(payload.response?.body?.items),
  };
}
