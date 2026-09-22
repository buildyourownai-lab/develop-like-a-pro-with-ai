import { XMLParser } from "fast-xml-parser";

// 공공데이터포털 "국토교통부_아파트 매매 실거래가 자료" (data.go.kr ID 15126469)
// 비슷한 이름의 "상세 자료"(ID 15126468, RTMSDataSvcAptTradeDev)와는 다른 데이터이므로 혼동 주의.
const ENDPOINT = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";

export interface AptTradeRecord {
  aptName: string;
  legalDong: string;
  jibun: string;
  buildingDong?: string;
  floor: number;
  exclusiveAreaSqm: number;
  buildYear: number;
  dealDate: string;
  dealAmountManwon: number;
  isCancelled: boolean;
  cancelledDate?: string;
  raw: Record<string, unknown>;
}

export interface FetchAptTradesParams {
  /** 법정동코드 앞 5자리 (시군구 코드) */
  lawdCd: string;
  /** 계약월, YYYYMM 형식 */
  dealYmd: string;
  numOfRows?: number;
}

// 공공데이터포털은 인증키를 인코딩 키와 디코딩 키 두 형태로 보여준다. 이미 인코딩된 키를
// 다시 인코딩하면 "등록되지 않은 서비스키" 오류가 나므로, 있는 그대로 붙여 보낸다.
function serviceKeyValue(key: string): string {
  return key.includes("%") ? key : encodeURIComponent(key);
}

function toRecord(item: Record<string, unknown>): AptTradeRecord {
  const str = (v: unknown) => String(v ?? "").trim();
  const num = (v: unknown) => Number(str(v).replace(/,/g, "")) || 0;

  const year = str(item.dealYear);
  const month = str(item.dealMonth).padStart(2, "0");
  const day = str(item.dealDay).padStart(2, "0");
  // 이 데이터셋(15126469)이 해제여부 필드를 실제로 내려주는지는 공식 문서로 확인되지 않았음.
  // 필드가 없으면 str()이 빈 문자열을 반환해 자연히 "해제 아님"으로 처리된다.
  const cancelType = str(item.cdealType);

  return {
    aptName: str(item.aptNm),
    legalDong: str(item.umdNm),
    jibun: str(item.jibun),
    buildingDong: str(item.aptDong) || undefined,
    floor: num(item.floor),
    exclusiveAreaSqm: num(item.excluUseAr),
    buildYear: num(item.buildYear),
    dealDate: `${year}-${month}-${day}`,
    dealAmountManwon: num(item.dealAmount),
    isCancelled: cancelType === "O",
    cancelledDate: str(item.cdealDay) || undefined,
    raw: item,
  };
}

interface ParsedAptTradePage {
  records: AptTradeRecord[];
  totalCount: number;
}

function parseAptTradePage(xml: string): ParsedAptTradePage {
  const parsed = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    // resultCode 같은 "00" 형태 값이 숫자 0으로 변환되며 앞의 0이 사라지는 것을 방지
    parseTagValue: false,
  }).parse(xml);

  const authError = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (authError) {
    throw new Error(`MOLIT API 인증/요청 오류: ${authError.errMsg} (${authError.returnAuthMsg})`);
  }

  const header = parsed?.response?.header;
  // 정상 응답 코드는 "00"과 "000" 두 형태로 관측된다. 2026-08-30 실제 응답은 "000"이었다.
  if (header && header.resultCode !== "00" && header.resultCode !== "000") {
    throw new Error(`MOLIT API 오류: ${header.resultCode} ${header.resultMsg ?? ""}`);
  }

  const body = parsed?.response?.body;
  const items = body?.items?.item;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const records = list.map(toRecord);

  return { records, totalCount: Number(body?.totalCount ?? records.length) };
}

/** API 응답 XML 문자열을 파싱해 거래 목록으로 변환한다. 네트워크 호출 없이 단독으로 테스트 가능. */
export function parseAptTradeXml(xml: string): AptTradeRecord[] {
  return parseAptTradePage(xml).records;
}

/** 한 시군구·한 달치 거래를 페이지 전체(totalCount만큼) 가져온다. */
export async function fetchAptTrades({
  lawdCd,
  dealYmd,
  numOfRows = 1000,
}: FetchAptTradesParams): Promise<AptTradeRecord[]> {
  const serviceKey = process.env.MOLIT_SERVICE_KEY;
  if (!serviceKey) {
    throw new Error("MOLIT_SERVICE_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }

  const all: AptTradeRecord[] = [];
  let pageNo = 1;

  while (true) {
    const query = new URLSearchParams({
      LAWD_CD: lawdCd,
      DEAL_YMD: dealYmd,
      numOfRows: String(numOfRows),
      pageNo: String(pageNo),
    });
    const requestUrl = `${ENDPOINT}?serviceKey=${serviceKeyValue(serviceKey)}&${query.toString()}`;

    const res = await fetch(requestUrl, { cache: "no-store" });
    const xml = await res.text();
    const page = parseAptTradePage(xml);
    all.push(...page.records);

    if (page.records.length === 0 || all.length >= page.totalCount) break;
    pageNo += 1;
  }

  return all;
}

export function formatAptTrade(t: AptTradeRecord): string {
  const price = `${t.dealAmountManwon.toLocaleString("ko-KR")}만원`;
  const cancelNote = t.isCancelled ? ` [거래해제됨, 해제일 ${t.cancelledDate}]` : "";
  return `${t.aptName} (${t.legalDong} ${t.jibun}) · 전용 ${t.exclusiveAreaSqm}㎡ · ${t.floor}층 · ${t.buildYear}년 건축 · 계약일 ${t.dealDate} · ${price}${cancelNote}`;
}
