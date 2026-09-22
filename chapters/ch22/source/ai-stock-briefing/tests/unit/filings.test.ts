import assert from "node:assert/strict";
import test from "node:test";

import {
  CHART_MARKER_TYPES,
  corpMapFromXml,
  describeNote,
  filingDocumentUrl,
  filingPageFromPayload,
  pageWindow,
  selectRepresentativeFilings,
  toFiling,
  toFilingMarkers,
} from "../../src/lib/filings";
import type { RawDartFiling } from "../../src/lib/types";

function raw(overrides: Partial<RawDartFiling> = {}): RawDartFiling {
  return {
    corp_code: "00164779",
    corp_name: "SK하이닉스",
    stock_code: "000660",
    corp_cls: "Y",
    report_nm: "주식소각결정              ",
    rcept_no: "20260819800340",
    flr_nm: "SK하이닉스 ",
    rcept_dt: "20260819",
    rm: "유정",
    ...overrides,
  };
}

test("OpenDART 응답의 보고서명·제출인 공백과 비고 코드를 정리하고 원문 링크를 만든다", () => {
  const filing = toFiling(raw());
  assert.deepEqual(filing, {
    receiptNo: "20260819800340",
    receiptDate: "20260819",
    reportName: "주식소각결정",
    filerName: "SK하이닉스",
    noteLabels: ["유가증권시장", "정정 보고"],
    documentUrl: "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=20260819800340",
  });
  assert.deepEqual(describeNote("코철"), ["코스닥시장", "철회"]);
  assert.equal(filingDocumentUrl("20260819800340"), filing.documentUrl);
});

test("정상·페이지네이션·자료 없음(013)·API 오류 응답을 구분한다", () => {
  const page = filingPageFromPayload(
    { status: "000", message: "정상", page_no: 2, total_count: 101, total_page: 2, list: [raw()] },
    1
  );
  assert.equal(page.pageNo, 2);
  assert.equal(page.totalCount, 101);
  assert.equal(page.totalPage, 2);
  assert.equal(page.filings.length, 1);

  assert.deepEqual(filingPageFromPayload({ status: "013", message: "조회된 데이타가 없습니다." }, 3), {
    filings: [],
    totalCount: 0,
    pageNo: 3,
    totalPage: 0,
  });
  assert.throws(
    () => filingPageFromPayload({ status: "020", message: "요청 제한" }, 1),
    /요청 한도/
  );
  assert.throws(
    () => filingPageFromPayload({ status: "777", message: "unknown" }, 1),
    /777: unknown/
  );
});

test("corpCode XML은 SK하이닉스를 00164779에 연결하고 중복 종목은 최신 수정일을 쓴다", () => {
  const entry = (corpCode: string, name: string, stockCode: string, modifyDate: string) =>
    `<list><corp_code>${corpCode}</corp_code><corp_name>${name}</corp_name><corp_eng_name></corp_eng_name><stock_code>${stockCode}</stock_code><modify_date>${modifyDate}</modify_date></list>`;
  const map = corpMapFromXml(
    entry("99999999", "과거 이름", "000660", "20200101") +
      entry("00164779", " SK하이닉스 ", "000660", "20240328") +
      entry("00000001", "비상장", "", "20260101")
  );
  assert.deepEqual(map.get("000660"), {
    corpCode: "00164779",
    corpName: "SK하이닉스",
    stockCode: "000660",
    modifyDate: "20240328",
  });
  assert.equal(map.size, 1);
});

test("차트 선별은 OpenDART 정기공시(A)·주요사항보고(B)만 쓰며 같은 날 여러 공시를 보존한다", () => {
  assert.deepEqual(CHART_MARKER_TYPES, ["A", "B"]);
  const first = toFiling(raw({ rcept_no: "20260817000001", rcept_dt: "20260817", report_nm: "정기보고" }));
  const second = toFiling(raw({ rcept_no: "20260817000002", rcept_dt: "20260817", report_nm: "주요사항" }));
  const result = toFilingMarkers(
    [
      { filing: first, typeCode: "A" },
      { filing: second, typeCode: "B" },
    ],
    ["20260814", "20260818", "20260819"]
  );
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].tradingDate, "20260818");
  assert.equal(result.markers[0].items.length, 2);
  assert.deepEqual(result.markers[0].items.map((item) => item.typeLabel), ["정기공시", "주요사항보고"]);
});

test("마지막 거래일 뒤 공시는 인과관계 없이 별도 건수로 남기고 페이지 창을 계산한다", () => {
  const future = toFiling(raw({ rcept_no: "20260820000001", rcept_dt: "20260820" }));
  const result = toFilingMarkers([{ filing: future, typeCode: "A" }], ["20260819"]);
  assert.deepEqual(result, { markers: [], afterChartCount: 1 });
  assert.deepEqual(pageWindow(1, 10), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageWindow(10, 10), [6, 7, 8, 9, 10]);
});

test("AI 브리핑 대표 공시는 주요사항 2·정기 2·거래소 1건을 유형별 최신순으로 고른다", () => {
  const entries = [
    ["B", "20260819", "주요사항 1"], ["B", "20260818", "주요사항 2"], ["B", "20260817", "주요사항 3"],
    ["A", "20260816", "정기 1"], ["A", "20260815", "정기 2"],
    ["I", "20260814", "거래소 1"], ["I", "20260813", "거래소 2"],
  ].map(([typeCode, date, name], index) => ({
    typeCode,
    filing: toFiling(raw({ rcept_no: `202608${String(index + 1).padStart(8, "0")}`, rcept_dt: date, report_nm: name })),
  }));
  const selected = selectRepresentativeFilings(entries);
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map((filing) => filing.disclosureTypeCode).sort(), ["A", "A", "B", "B", "I"]);
  assert.ok(selected.every((filing) => filing.documentUrl.startsWith("https://dart.fss.or.kr/")));
});
