import "server-only";

import { getDataGoKrServiceKey } from "./server-env";

const NORMAL_RESULT_CODES = new Set(["00", "000"]);

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

  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
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
