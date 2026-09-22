import "server-only";
import { getOpenDartApiKey } from "./server-env";
import { findCorpCodeByStockCode } from "./dart-corp-code";

const DISCLOSURE_LIST_ENDPOINT = "https://opendart.fss.or.kr/api/list.json";
const DART_VIEWER_ENDPOINT = "https://dart.fss.or.kr/dsaf001/main.do";
export const RECENT_DISCLOSURE_COUNT = 5;
// "전체 공시" 화면은 한 페이지에 100건씩, OpenDART가 응답으로 주는 페이지
// 정보(page_no/total_page)에 맞춰 나눠 보여준다 — 조회 기간의 공시를 하나도
// 빼지 않으면서도 한 화면에 수백 건을 몰아 쌓지 않기 위함이다.
export const FULL_LIST_PAGE_COUNT = 100;

// OpenDART 공식 공시유형(pblntf_ty) 코드다. OpenDART 개발가이드에 정의된
// 값 그대로이며, 보고서 제목을 보고 임의로 중요도를 나누거나 새 분류를
// 만들지 않기 위해 이 코드만 필터 기준으로 쓴다.
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

export function isDisclosureTypeCode(
  value: string
): value is DisclosureTypeCode {
  return DISCLOSURE_TYPES.some((t) => t.code === value);
}

export interface DisclosureTypeCount {
  code: DisclosureTypeCode;
  label: string;
  count: number;
}

export interface DisclosureItem {
  receiptNo: string;
  receiptDate: string;
  reportName: string;
  submitter: string;
  remarks: string;
  dartUrl: string;
}

export interface DisclosurePage {
  items: DisclosureItem[];
  totalCount: number;
  totalPage: number;
  pageNo: number;
  beginDate: string;
  endDate: string;
  disclosureType: DisclosureTypeCode | null;
}

type DartListResponse = {
  status: string;
  message?: string;
  total_count?: number;
  total_page?: number;
  list?: Array<{
    rcept_no: string;
    rcept_dt: string;
    report_nm: string;
    flr_nm: string;
    rm: string;
  }>;
};

function toDisclosureItem(item: {
  rcept_no: string;
  rcept_dt: string;
  report_nm: string;
  flr_nm: string;
  rm: string;
}): DisclosureItem {
  return {
    receiptNo: item.rcept_no,
    receiptDate: item.rcept_dt,
    reportName: item.report_nm,
    submitter: item.flr_nm,
    remarks: item.rm ?? "",
    dartUrl: `${DART_VIEWER_ENDPOINT}?rcpNo=${item.rcept_no}`,
  };
}

async function fetchDisclosurePage(
  corpCode: string,
  beginDate: string,
  endDate: string,
  pageNo: number,
  pageCount: number,
  disclosureType?: DisclosureTypeCode
): Promise<{ items: DisclosureItem[]; totalCount: number; totalPage: number }> {
  const apiKey = getOpenDartApiKey();
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    corp_code: corpCode,
    bgn_de: beginDate,
    end_de: endDate,
    page_no: String(pageNo),
    // OpenDART list.json의 페이지당 건수 파라미터 이름은 "page_count"다
    // ("page_size"가 아니다) — 실제 응답으로 확인했다: 다른 이름을 쓰면
    // 조용히 무시되고 기본값(10건)이 돌아온다.
    page_count: String(pageCount),
    sort: "date",
    sort_mth: "desc",
    ...(disclosureType ? { pblntf_ty: disclosureType } : {}),
  });

  const res = await fetch(`${DISCLOSURE_LIST_ENDPOINT}?${params.toString()}`);
  const json = (await res.json()) as DartListResponse;

  // "013"은 OpenDART가 조회 결과 0건일 때 쓰는 상태 코드다(오류가 아니다).
  if (json.status === "013") return { items: [], totalCount: 0, totalPage: 0 };
  if (json.status !== "000") {
    throw new Error(
      `OpenDART 공시검색 호출 실패: ${json.status} ${json.message ?? ""}`
    );
  }

  return {
    items: (json.list ?? []).map(toDisclosureItem),
    totalCount: json.total_count ?? 0,
    totalPage: json.total_page ?? 0,
  };
}

// 종목이 beginDate~endDate 사이에 제출한 공시 중 최신 몇 건만 돌려준다.
// 이 기간은 호출하는 쪽(종목 상세 화면)이 주가 차트와 같은 기간으로 맞춰
// 넘긴다 — 여기서 임의로 정하지 않는다. 어떤 공시가 있었는지, 이 기간에
// 전체 몇 건이었는지만 사실대로 알려주며, 이 목록이 주가 움직임의 원인
// 이라고 해석하지 않는다 — 그 해석은 호출하는 쪽에서도 추가하면 안 된다.
export async function getRecentDisclosuresByStockCode(
  stockCode: string,
  beginDate: string,
  endDate: string,
  count = RECENT_DISCLOSURE_COUNT
): Promise<DisclosurePage> {
  const corpCode = await findCorpCodeByStockCode(stockCode);
  if (!corpCode) {
    return {
      items: [],
      totalCount: 0,
      totalPage: 0,
      pageNo: 1,
      beginDate,
      endDate,
      disclosureType: null,
    };
  }

  const { items, totalCount, totalPage } = await fetchDisclosurePage(
    corpCode,
    beginDate,
    endDate,
    1,
    count
  );
  return {
    items,
    totalCount,
    totalPage,
    pageNo: 1,
    beginDate,
    endDate,
    disclosureType: null,
  };
}

// "전체 공시" 화면용: beginDate~endDate 사이의 공시를 하나도 빼지 않고
// 페이지 단위로 돌려준다. 이 기간은 호출하는 쪽이 "최근 공시"와 같은
// 기간으로 맞춰 넘긴다. disclosureType을 주면 OpenDART 공식 공시유형
// 하나로 좁혀서 조회한다.
export async function getDisclosurePageByStockCode(
  stockCode: string,
  beginDate: string,
  endDate: string,
  pageNo: number,
  options: {
    pageCount?: number;
    disclosureType?: DisclosureTypeCode;
  } = {}
): Promise<DisclosurePage> {
  const { pageCount = FULL_LIST_PAGE_COUNT, disclosureType } = options;

  const corpCode = await findCorpCodeByStockCode(stockCode);
  if (!corpCode) {
    return {
      items: [],
      totalCount: 0,
      totalPage: 0,
      pageNo,
      beginDate,
      endDate,
      disclosureType: disclosureType ?? null,
    };
  }

  const { items, totalCount, totalPage } = await fetchDisclosurePage(
    corpCode,
    beginDate,
    endDate,
    pageNo,
    pageCount,
    disclosureType
  );
  return {
    items,
    totalCount,
    totalPage,
    pageNo,
    beginDate,
    endDate,
    disclosureType: disclosureType ?? null,
  };
}

// 필터 링크에 함께 보여줄, beginDate~endDate 기간의 유형별 실제 건수다.
// 목록과 같은 기간으로 맞춰 넘겨야 필터를 눌렀을 때 건수와 실제 목록이
// 서로 다르게 보이지 않는다. 제목을 보고 판단하지 않고 OpenDART에
// 유형별로 직접 물어서 얻은 값 그대로다.
export async function getDisclosureTypeCounts(
  stockCode: string,
  beginDate: string,
  endDate: string
): Promise<DisclosureTypeCount[]> {
  const corpCode = await findCorpCodeByStockCode(stockCode);
  if (!corpCode) {
    return DISCLOSURE_TYPES.map((t) => ({ ...t, count: 0 }));
  }

  return Promise.all(
    DISCLOSURE_TYPES.map(async (t) => {
      const { totalCount } = await fetchDisclosurePage(
        corpCode,
        beginDate,
        endDate,
        1,
        1,
        t.code
      );
      return { ...t, count: totalCount };
    })
  );
}

// 차트에 표시할 공시유형이다. OpenDART 공식 분류 중 정기공시(A)·주요사항
// 보고(B) 두 가지만 쓴다 — 보고서 제목이나 내용을 보고 중요도를 판단하거나
// 새 기준으로 순위를 매기지 않고, OpenDART가 이미 정해 둔 분류만 그대로
// 따른다.
export const CHART_DISCLOSURE_TYPES: readonly DisclosureTypeCode[] = [
  "A",
  "B",
];

export interface DisclosureMarker extends DisclosureItem {
  disclosureType: DisclosureTypeCode;
}

const CHART_MARKER_PAGE_COUNT = 100;

async function fetchAllDisclosuresForType(
  corpCode: string,
  beginDate: string,
  endDate: string,
  disclosureType: DisclosureTypeCode
): Promise<DisclosureMarker[]> {
  const first = await fetchDisclosurePage(
    corpCode,
    beginDate,
    endDate,
    1,
    CHART_MARKER_PAGE_COUNT,
    disclosureType
  );
  const allItems = [first.items];
  for (let pageNo = 2; pageNo <= first.totalPage; pageNo++) {
    const next = await fetchDisclosurePage(
      corpCode,
      beginDate,
      endDate,
      pageNo,
      CHART_MARKER_PAGE_COUNT,
      disclosureType
    );
    allItems.push(next.items);
  }
  return allItems.flat().map((item) => ({ ...item, disclosureType }));
}

// 차트 구간(beginDate~endDate)에 있었던 정기공시·주요사항보고 시점을
// 모두 돌려준다. 어떤 날짜에 어떤 유형의 공시가 있었는지만 사실대로
// 알려주며, 이 시점이 그날 주가 움직임의 원인이라고 해석하지 않는다.
export async function getChartDisclosureMarkersByStockCode(
  stockCode: string,
  beginDate: string,
  endDate: string
): Promise<DisclosureMarker[]> {
  const corpCode = await findCorpCodeByStockCode(stockCode);
  if (!corpCode) return [];

  const perType = await Promise.all(
    CHART_DISCLOSURE_TYPES.map((type) =>
      fetchAllDisclosuresForType(corpCode, beginDate, endDate, type)
    )
  );
  return perType.flat().sort((a, b) => a.receiptDate.localeCompare(b.receiptDate));
}
