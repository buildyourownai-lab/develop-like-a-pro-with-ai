import type { DartCorp, Filing, FilingMarker, RawDartFiling, RepresentativeFiling } from "./types";

export type DartListPayload = {
  status: string;
  message: string;
  page_no?: number;
  page_count?: number;
  total_count?: number;
  total_page?: number;
  list?: RawDartFiling[];
};

const STATUS_MESSAGE: Record<string, string> = {
  "010": "등록되지 않은 인증키입니다.",
  "011": "사용할 수 없는 인증키입니다.",
  "012": "접근할 수 없는 IP입니다.",
  "020": "OpenDART 요청 한도를 초과했습니다.",
  "100": "요청한 값이 올바르지 않습니다.",
  "800": "OpenDART가 점검 중입니다.",
  "900": "정의되지 않은 오류입니다.",
  "901": "사용할 수 없는 인증키입니다.",
};

/** DART 원문을 여는 주소. 접수번호 하나로 만들어진다. */
export function filingDocumentUrl(receiptNo: string): string {
  return `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${receiptNo}`;
}

/**
 * OpenDART 공시검색은 보고서명 뒤에 공백을 붙여 준다.
 * 비고(rm)는 "유정"처럼 코드가 붙어서 한 칸에 여러 개가 들어온다.
 */
const NOTE_LABELS: Record<string, string> = {
  유: "유가증권시장",
  코: "코스닥시장",
  채: "채권상장법인",
  넥: "코넥스시장",
  공: "공정거래위원회",
  연: "연결부분",
  정: "정정 보고",
  철: "철회",
};

export function describeNote(rm: string): string[] {
  return [...rm.trim()].map((mark) => NOTE_LABELS[mark]).filter((label): label is string => Boolean(label));
}

export function toFiling(raw: RawDartFiling): Filing {
  return {
    receiptNo: raw.rcept_no,
    receiptDate: raw.rcept_dt,
    reportName: raw.report_nm.trim(),
    filerName: raw.flr_nm.trim(),
    noteLabels: describeNote(raw.rm ?? ""),
    documentUrl: filingDocumentUrl(raw.rcept_no),
  };
}

/** OpenDART list.json의 상태·페이지 정보를 화면에서 쓰는 공시 페이지로 바꾼다. */
export function filingPageFromPayload(payload: DartListPayload, fallbackPageNo: number) {
  if (payload.status !== "000" && payload.status !== "013") {
    throw new Error(
      STATUS_MESSAGE[payload.status] ??
        `OpenDART 응답이 정상이 아닙니다. (${payload.status}: ${payload.message})`
    );
  }
  return {
    filings: (payload.list ?? []).map(toFiling),
    totalCount: Number(payload.total_count ?? 0),
    pageNo: Number(payload.page_no ?? fallbackPageNo),
    totalPage: Number(payload.total_page ?? 0),
  };
}

/** corpCode.xml에서 상장회사만 남기며 같은 종목코드는 수정일이 최신인 항목을 쓴다. */
export function corpMapFromXml(xml: string): Map<string, DartCorp> {
  const pattern =
    /<corp_code>(\d+)<\/corp_code>\s*<corp_name>([^<]*)<\/corp_name>\s*<corp_eng_name>[^<]*<\/corp_eng_name>\s*<stock_code>(\d{6})<\/stock_code>\s*<modify_date>(\d{8})<\/modify_date>/g;
  const map = new Map<string, DartCorp>();
  for (const [, corpCode, corpName, stockCode, modifyDate] of xml.matchAll(pattern)) {
    const previous = map.get(stockCode);
    if (previous && Number(previous.modifyDate) >= Number(modifyDate)) continue;
    map.set(stockCode, { corpCode, corpName: corpName.trim(), stockCode, modifyDate });
  }
  return map;
}

/**
 * OpenDART가 정해 둔 공시유형이다. 우리가 만든 분류가 아니다.
 * 화면의 유형 구분은 전부 이 코드로만 한다.
 */
export const DISCLOSURE_TYPES = [
  { code: "A", label: "정기공시" },
  { code: "B", label: "주요사항보고" },
  { code: "C", label: "발행공시" },
  { code: "D", label: "지분공시" },
  { code: "E", label: "기타공시" },
  { code: "F", label: "외부감사관련" },
  { code: "G", label: "펀드공시" },
  { code: "H", label: "자산유동화" },
  { code: "I", label: "거래소공시" },
  { code: "J", label: "공정위공시" },
] as const;

export type DisclosureTypeCode = (typeof DISCLOSURE_TYPES)[number]["code"];

export function isDisclosureTypeCode(value: string): value is DisclosureTypeCode {
  return DISCLOSURE_TYPES.some((type) => type.code === value);
}

export function disclosureTypeLabel(code: string): string {
  return DISCLOSURE_TYPES.find((type) => type.code === code)?.label ?? code;
}

/**
 * 차트에 시점을 표시할 공시를 고르는 규칙.
 * 우리가 중요도를 판단하지 않는다. OpenDART 공시유형 중 두 가지만 그대로 쓴다.
 */
export const CHART_MARKER_TYPES: DisclosureTypeCode[] = ["A", "B"];

export const CHART_MARKER_RULE_TEXT =
  "중요도나 순위는 매기지 않습니다.";

export const BRIEFING_FILING_TYPES = ["B", "A", "I"] as const;
export const BRIEFING_FILING_RULE_TEXT =
  "OpenDART 공식 유형별 최신순으로 주요사항보고 2건, 정기공시 2건, 거래소공시 1건을 고릅니다. 부족한 유형은 세 유형의 다음 최신 공시로 채웁니다.";

const BRIEFING_FILING_QUOTAS = { B: 2, A: 2, I: 1 } as const;

/** 주관적인 중요도 판단 없이 공식 유형과 접수일만으로 대표 공시 5건을 고른다. */
export function selectRepresentativeFilings(
  filings: { filing: Filing; typeCode: string }[]
): RepresentativeFiling[] {
  const candidates = filings
    .filter((entry): entry is { filing: Filing; typeCode: (typeof BRIEFING_FILING_TYPES)[number] } =>
      (BRIEFING_FILING_TYPES as readonly string[]).includes(entry.typeCode)
    )
    .sort((a, b) =>
      b.filing.receiptDate.localeCompare(a.filing.receiptDate) ||
      b.filing.receiptNo.localeCompare(a.filing.receiptNo)
    );
  const selected: typeof candidates = [];
  const used = new Set<string>();

  for (const typeCode of BRIEFING_FILING_TYPES) {
    for (const entry of candidates.filter((candidate) => candidate.typeCode === typeCode).slice(0, BRIEFING_FILING_QUOTAS[typeCode])) {
      if (!used.has(entry.filing.receiptNo)) {
        selected.push(entry);
        used.add(entry.filing.receiptNo);
      }
    }
  }
  for (const entry of candidates) {
    if (selected.length >= 5) break;
    if (!used.has(entry.filing.receiptNo)) {
      selected.push(entry);
      used.add(entry.filing.receiptNo);
    }
  }

  return selected
    .sort((a, b) =>
      b.filing.receiptDate.localeCompare(a.filing.receiptDate) ||
      b.filing.receiptNo.localeCompare(a.filing.receiptNo)
    )
    .map(({ filing, typeCode }) => ({
      ...filing,
      disclosureTypeCode: typeCode,
      disclosureTypeLabel: disclosureTypeLabel(typeCode),
      selectionReason: `${disclosureTypeLabel(typeCode)} 중 접수일 최신순`,
    }));
}

/**
 * 접수일을 차트의 거래일 자리에 맞춘다.
 * 주말·휴일에 접수된 공시는 그 다음 첫 거래일 자리에 놓는다.
 * 마지막 거래일보다 뒤에 접수된 공시는 차트에 놓을 자리가 없으므로 표시하지 않는다.
 */
export function toFilingMarkers(
  filings: { filing: Filing; typeCode: string }[],
  tradingDates: string[]
): { markers: FilingMarker[]; afterChartCount: number } {
  if (tradingDates.length === 0) {
    return { markers: [], afterChartCount: filings.length };
  }

  const sorted = [...tradingDates].sort();
  const lastTradingDate = sorted[sorted.length - 1];
  const byTradingDate = new Map<string, FilingMarker>();
  let afterChartCount = 0;

  for (const entry of [...filings].sort((a, b) => a.filing.receiptDate.localeCompare(b.filing.receiptDate))) {
    if (entry.filing.receiptDate > lastTradingDate) {
      afterChartCount += 1;
      continue;
    }
    const tradingDate = sorted.find((date) => date >= entry.filing.receiptDate);
    if (!tradingDate) {
      afterChartCount += 1;
      continue;
    }
    const marker = byTradingDate.get(tradingDate) ?? { tradingDate, items: [] };
    marker.items.push({
      receiptNo: entry.filing.receiptNo,
      receiptDate: entry.filing.receiptDate,
      reportName: entry.filing.reportName,
      filerName: entry.filing.filerName,
      typeLabel: disclosureTypeLabel(entry.typeCode),
      documentUrl: entry.filing.documentUrl,
    });
    byTradingDate.set(tradingDate, marker);
  }

  return {
    markers: [...byTradingDate.values()].sort((a, b) => a.tradingDate.localeCompare(b.tradingDate)),
    afterChartCount,
  };
}

/** 465건 중 324건이 지분공시라는 구성을 그대로 보여 주기 위한 정리. */
export function sortTypeCounts(counts: { code: string; label: string; count: number }[]) {
  return counts.filter((entry) => entry.count > 0).sort((a, b) => b.count - a.count);
}

/** 100건씩 나눠 볼 때 몇 페이지가 되는지. OpenDART가 주는 total_page와 맞춰 쓴다. */
export function pageWindow(pageNo: number, totalPage: number, span = 5): number[] {
  if (totalPage <= 0) {
    return [];
  }
  const half = Math.floor(span / 2);
  let start = Math.max(1, pageNo - half);
  const end = Math.min(totalPage, start + span - 1);
  start = Math.max(1, end - span + 1);
  const pages: number[] = [];
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  return pages;
}
