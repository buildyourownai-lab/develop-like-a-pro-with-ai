import "server-only";

import { chapter12Options, recordChapter12Metric } from "./chapter12-metrics";
import { readServiceKey } from "./env";
import { readFscSnapshot, writeFscSnapshot } from "./supabase-stock-store";

const BASE = "https://apis.data.go.kr/1160100/service";

export const FSC_ENDPOINT = {
  /** 금융위원회 주식시세정보 */
  stockPrice: `${BASE}/GetStockSecuritiesInfoService/getStockPriceInfo`,
  /** 금융위원회 지수시세정보 */
  marketIndex: `${BASE}/GetMarketIndexInfoService/getStockMarketIndex`,
  /** 금융위원회 KRX상장종목정보 */
  listedInfo: `${BASE}/GetKrxListedInfoService/getItemInfo`,
} as const;

/** 이 서비스들은 정상 응답 코드로 "00"을 준다. "000"을 주는 다른 공공데이터 서비스도 있어 둘 다 받아 준다. */
const NORMAL_RESULT_CODES = new Set(["00", "000"]);

type FscBody<T> = {
  numOfRows?: number;
  pageNo?: number;
  totalCount?: number;
  items?: { item?: T | T[] } | "";
};

type FscPayload<T> = {
  response?: {
    header?: { resultCode?: string; resultMsg?: string };
    body?: FscBody<T>;
  };
};

export type FscPage<T> = {
  items: T[];
  totalCount: number;
};

/**
 * 인증키가 이미 URL 인코딩된 형태(%2F, %3D 포함)로 발급되는 경우가 있다.
 * 이미 인코딩된 키를 다시 인코딩하면 인증이 실패하므로 %가 있으면 그대로 쓴다.
 */
function serviceKeyValue(serviceKey: string): string {
  return serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
}

/** 인증키 문제 등은 JSON이 아니라 XML 오류 문서로 돌아온다. */
function describeNonJson(text: string): string {
  const reason = /<returnAuthMsg>([^<]+)<\/returnAuthMsg>/.exec(text)?.[1];
  const message = /<errMsg>([^<]+)<\/errMsg>/.exec(text)?.[1];
  if (reason || message) {
    return `공공데이터포털이 오류를 반환했습니다: ${[message, reason].filter(Boolean).join(" / ")}`;
  }
  return "공공데이터포털 응답을 JSON으로 읽을 수 없습니다.";
}

export async function fscFetch<T>(
  endpoint: string,
  params: Record<string, string | number>,
  options: { revalidate?: number; databaseTtlSeconds?: number } = {}
): Promise<FscPage<T>> {
  const stored = await readFscSnapshot<T>(endpoint, params);
  if (stored) return stored;

  const query = new URLSearchParams({ resultType: "json" });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  const url = `${endpoint}?serviceKey=${serviceKeyValue(readServiceKey())}&${query.toString()}`;
  const started = performance.now();
  const response = await fetch(
    url,
    chapter12Options().bypassNextCache
      ? { cache: "no-store", signal: AbortSignal.timeout(45_000) }
      : { next: { revalidate: options.revalidate ?? 600 }, signal: AbortSignal.timeout(45_000) }
  );
  recordChapter12Metric({
    service: "fsc",
    operation: endpoint.split("/").at(-1) ?? "request",
    durationMs: performance.now() - started,
    outcome: "network",
  });

  if (!response.ok) {
    throw new Error(`공공데이터포털 요청이 실패했습니다. (HTTP ${response.status})`);
  }

  const text = await response.text();
  let payload: FscPayload<T>;
  try {
    payload = JSON.parse(text) as FscPayload<T>;
  } catch {
    throw new Error(describeNonJson(text));
  }

  const resultCode = String(payload.response?.header?.resultCode ?? "");
  if (!NORMAL_RESULT_CODES.has(resultCode)) {
    const resultMsg = payload.response?.header?.resultMsg ?? "알 수 없는 오류";
    throw new Error(`공공데이터포털 응답이 정상이 아닙니다. (${resultCode}: ${resultMsg})`);
  }

  const page = {
    items: normalizeItems(payload.response?.body?.items),
    totalCount: Number(payload.response?.body?.totalCount ?? 0),
  };
  const sourceBaseDate = page.items.find(
    (item): item is T & { basDt: string } =>
      typeof item === "object" && item !== null && typeof (item as { basDt?: unknown }).basDt === "string"
  )?.basDt;
  await writeFscSnapshot({
    endpoint,
    params,
    payload: page,
    sourceBaseDate,
    ttlSeconds:
      chapter12Options().databaseTtlSeconds ?? options.databaseTtlSeconds ?? options.revalidate ?? 600,
  });
  return page;
}

/** 결과가 0건이면 items가 빈 문자열이고, 1건이면 배열이 아니라 객체 하나로 온다. */
function normalizeItems<T>(items: { item?: T | T[] } | "" | undefined): T[] {
  if (!items || typeof items !== "object") {
    return [];
  }
  const item = items.item;
  if (!item) {
    return [];
  }
  return Array.isArray(item) ? item : [item];
}
