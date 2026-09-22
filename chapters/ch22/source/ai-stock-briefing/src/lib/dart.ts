import "server-only";

import { chapter12Options, recordChapter12Metric } from "./chapter12-metrics";
import { readDartKey } from "./env";
import { DISCLOSURE_TYPES, filingPageFromPayload } from "./filings";
import type { DartListPayload } from "./filings";
import type { DartCorp, Filing } from "./types";
import corpSnapshot from "@/data/dart-corp-map.json";

const DART_BASE = "https://opendart.fss.or.kr/api";

/** OpenDART 공시검색은 한 번에 최대 100건까지 준다. */
export const FILINGS_PAGE_SIZE = 100;

export type FilingPage = {
  filings: Filing[];
  totalCount: number;
  pageNo: number;
  totalPage: number;
};

async function dartList(params: Record<string, string | number>): Promise<DartListPayload> {
  const query = new URLSearchParams({ crtfc_key: readDartKey() });
  for (const [key, value] of Object.entries(params)) {
    query.set(key, String(value));
  }

  const started = performance.now();
  const response = await fetch(
    `${DART_BASE}/list.json?${query.toString()}`,
    chapter12Options().bypassNextCache
      ? { cache: "no-store", signal: AbortSignal.timeout(30_000) }
      : { next: { revalidate: 600 }, signal: AbortSignal.timeout(30_000) }
  );
  recordChapter12Metric({
    service: "dart",
    operation: "list",
    durationMs: performance.now() - started,
    outcome: "network",
  });

  if (!response.ok) {
    throw new Error(`OpenDART 요청이 실패했습니다. (HTTP ${response.status})`);
  }

  return (await response.json()) as DartListPayload;
}

/**
 * 주식시세에서 쓰는 여섯 자리 종목코드와 공시에서 쓰는 회사 고유번호는 다른 값이다.
 * OpenDART가 주는 고유번호 파일에서 둘을 연결한다.
 * 파일은 zip 하나에 XML 하나가 들어 있고 11만 건이 넘는다.
 * 그래서 한 번 읽어 상장회사만 남기고 서버가 살아 있는 동안 다시 쓴다.
 */
const corpMap = new Map(
  (corpSnapshot as DartCorp[]).map((corp) => [corp.stockCode, corp] as const)
);

export async function findCorpByStockCode(stockCode: string): Promise<DartCorp | null> {
  return corpMap.get(stockCode) ?? null;
}

/** 한 회사의 공시를 접수일 최신순으로 받는다. */
export async function fetchFilings(options: {
  corpCode: string;
  from: string;
  to: string;
  pageNo?: number;
  pageCount?: number;
  typeCode?: string;
}): Promise<FilingPage> {
  const pageNo = options.pageNo ?? 1;
  const payload = await dartList({
    corp_code: options.corpCode,
    bgn_de: options.from,
    end_de: options.to,
    page_no: pageNo,
    page_count: options.pageCount ?? FILINGS_PAGE_SIZE,
    ...(options.typeCode ? { pblntf_ty: options.typeCode } : {}),
  });

  return filingPageFromPayload(payload, pageNo);
}

/** 유형별로 몇 건인지. 건수만 필요하므로 한 건씩만 받아 total_count를 읽는다. */
export async function fetchFilingTypeCounts(options: { corpCode: string; from: string; to: string }) {
  const results = await Promise.all(
    DISCLOSURE_TYPES.map(async (type) => {
      const page = await fetchFilings({ ...options, pageNo: 1, pageCount: 1, typeCode: type.code });
      return { code: type.code as string, label: type.label as string, count: page.totalCount };
    })
  );
  return results;
}

/** 차트에 시점을 표시할 공시만 유형별로 받는다. */
export async function fetchFilingsByTypes(options: {
  corpCode: string;
  from: string;
  to: string;
  typeCodes: string[];
}): Promise<{ filing: Filing; typeCode: string }[]> {
  const pages = await Promise.all(
    options.typeCodes.map(async (typeCode) => {
      const page = await fetchFilings({ ...options, pageNo: 1, pageCount: FILINGS_PAGE_SIZE, typeCode });
      return page.filings.map((filing) => ({ filing, typeCode }));
    })
  );
  return pages.flat();
}
