import { describe, it, expect } from "vitest";
import { findCorpCodeByStockCode } from "@/lib/dart-corp-code";
import {
  getRecentDisclosuresByStockCode,
  getDisclosurePageByStockCode,
  getDisclosureTypeCounts,
  getChartDisclosureMarkersByStockCode,
  isDisclosureTypeCode,
  DISCLOSURE_TYPES,
  CHART_DISCLOSURE_TYPES,
  FULL_LIST_PAGE_COUNT,
} from "@/lib/dart-disclosure-api";

// 종목 상세 화면의 "최근 공시"는 주가 차트와 같은 최근 1년을 조회 기간으로
// 쓴다. 테스트에서도 같은 기간을 재사용해 여러 it()에서 값을 맞춘다.
const ONE_YEAR_BEGIN = "20250830";
const ONE_YEAR_END = "20260830";

describe("실제 OpenDART corpCode.xml로 종목코드→고유번호를 찾는다", () => {
  it("SK하이닉스(000660)의 고유번호를 찾는다", async () => {
    const corpCode = await findCorpCodeByStockCode("000660");
    expect(corpCode).not.toBeNull();
    expect(/^\d{8}$/.test(corpCode ?? "")).toBe(true);
  });

  it("존재하지 않는 종목코드는 null이다", async () => {
    const corpCode = await findCorpCodeByStockCode("999999");
    expect(corpCode).toBeNull();
  });
});

describe("실제 OpenDART 공시검색으로 최근 공시 요약을 가져온다", () => {
  it("SK하이닉스(000660)는 최근 공시 5건과 조회 기간의 전체 건수를 함께 준다", async () => {
    const page = await getRecentDisclosuresByStockCode("000660", ONE_YEAR_BEGIN, ONE_YEAR_END);
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.totalCount).toBeGreaterThanOrEqual(page.items.length);
    expect(/^\d{8}$/.test(page.beginDate)).toBe(true);
    expect(/^\d{8}$/.test(page.endDate)).toBe(true);

    for (const item of page.items) {
      expect(/^\d{8}$/.test(item.receiptDate)).toBe(true);
      expect(item.reportName.length).toBeGreaterThan(0);
      expect(item.submitter.length).toBeGreaterThan(0);
      expect(typeof item.remarks).toBe("string");
      expect(item.dartUrl).toBe(
        `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.receiptNo}`
      );
    }
  });

  it("접수일 내림차순으로 온다", async () => {
    const page = await getRecentDisclosuresByStockCode("000660", ONE_YEAR_BEGIN, ONE_YEAR_END);
    for (let i = 1; i < page.items.length; i++) {
      expect(page.items[i].receiptDate <= page.items[i - 1].receiptDate).toBe(
        true
      );
    }
  });

  it("존재하지 않는 종목코드는 0건이고, 조회 기간은 그대로 돌려준다", async () => {
    const page = await getRecentDisclosuresByStockCode("999999", ONE_YEAR_BEGIN, ONE_YEAR_END);
    expect(page.items).toHaveLength(0);
    expect(page.totalCount).toBe(0);
    expect(/^\d{8}$/.test(page.beginDate)).toBe(true);
  });
});

describe("실제 OpenDART 공시검색으로 전체 공시 목록을 페이지로 가져온다", () => {
  it("한 페이지가 OpenDART 기본 페이지당 건수를 넘지 않는다", async () => {
    const full = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(full.items.length).toBeLessThanOrEqual(FULL_LIST_PAGE_COUNT);
  });

  it("전체 목록은 요약과 같은 기간을 쓰고, 그 기간의 공시를 하나도 빼지 않는다", async () => {
    const summary = await getRecentDisclosuresByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    const full = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(full.beginDate).toBe(summary.beginDate);
    expect(full.endDate).toBe(summary.endDate);
    // 요약은 최신 5건만 보여주지만, 그 기간의 전체 건수(totalCount)는
    // 페이지 크기와 무관하게 같아야 한다 — 빠짐없이 세고 있다는 뜻이다.
    expect(full.totalCount).toBe(summary.totalCount);
  });

  it("1페이지는 요약의 최근 5건을 그대로 포함한다", async () => {
    const summary = await getRecentDisclosuresByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    const full = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(
      full.items.slice(0, summary.items.length).map((it) => it.receiptNo)
    ).toEqual(summary.items.map((it) => it.receiptNo));
  });

  it("전체 건수가 한 페이지보다 많으면 2페이지는 1페이지와 다른 공시를 담는다", async () => {
    const page1 = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    if (page1.totalPage < 2) return; // 조회 시점에 공시가 적으면 이 검증은 건너뛴다.

    const page2 = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      2
    );
    const page1Nos = new Set(page1.items.map((it) => it.receiptNo));
    for (const item of page2.items) {
      expect(page1Nos.has(item.receiptNo)).toBe(false);
    }
  });

  it("존재하지 않는 종목코드는 0건이다", async () => {
    const full = await getDisclosurePageByStockCode(
      "999999",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(full.items).toHaveLength(0);
    expect(full.totalCount).toBe(0);
  });
});

describe("OpenDART 공식 공시유형 코드", () => {
  it("공식 코드(A~J)만 유효하다고 판단한다", () => {
    for (const t of DISCLOSURE_TYPES) {
      expect(isDisclosureTypeCode(t.code)).toBe(true);
    }
    expect(isDisclosureTypeCode("Z")).toBe(false);
    expect(isDisclosureTypeCode("정기공시")).toBe(false);
  });
});

describe("실제 OpenDART 공시검색으로 유형별 실제 건수를 가져온다", () => {
  it("SK하이닉스(000660)는 공식 유형 10개 각각의 실제 건수를 준다", async () => {
    const counts = await getDisclosureTypeCounts(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    expect(counts).toHaveLength(DISCLOSURE_TYPES.length);
    expect(counts.map((c) => c.code)).toEqual(
      DISCLOSURE_TYPES.map((t) => t.code)
    );
    for (const c of counts) {
      expect(c.count).toBeGreaterThanOrEqual(0);
    }
  });

  it("유형별 건수를 모두 더하면 기간 전체(필터 없음) 건수와 같다", async () => {
    const counts = await getDisclosureTypeCounts(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    const sum = counts.reduce((total, c) => total + c.count, 0);
    const unfiltered = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(sum).toBe(unfiltered.totalCount);
  });

  it("유형 하나로 좁히면 그 유형의 실제 건수만큼만 전체 건수로 나온다", async () => {
    const counts = await getDisclosureTypeCounts(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    const nonZero = counts.find((c) => c.count > 0);
    expect(nonZero).toBeDefined();
    if (!nonZero) return;

    const filtered = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1,
      { disclosureType: nonZero.code }
    );
    expect(filtered.totalCount).toBe(nonZero.count);
    expect(filtered.disclosureType).toBe(nonZero.code);
  });

  it("존재하지 않는 종목코드는 10개 유형 모두 0건이다", async () => {
    const counts = await getDisclosureTypeCounts(
      "999999",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    expect(counts).toHaveLength(DISCLOSURE_TYPES.length);
    for (const c of counts) {
      expect(c.count).toBe(0);
    }
  });
});

describe("실제 OpenDART 공시검색으로 차트에 표시할 공시 시점을 가져온다", () => {
  it("SK하이닉스(000660)의 최근 1년 구간에서 정기공시·주요사항보고만 돌려준다", async () => {
    const markers = await getChartDisclosureMarkersByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) {
      expect(CHART_DISCLOSURE_TYPES).toContain(m.disclosureType);
      expect(m.receiptDate >= ONE_YEAR_BEGIN).toBe(true);
      expect(m.receiptDate <= ONE_YEAR_END).toBe(true);
    }
  });

  it("접수일 오름차순으로 온다", async () => {
    const markers = await getChartDisclosureMarkersByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    for (let i = 1; i < markers.length; i++) {
      expect(markers[i].receiptDate >= markers[i - 1].receiptDate).toBe(true);
    }
  });

  it("정기공시·주요사항보고 외 다른 유형은 섞이지 않고, 같은 공시가 중복되지 않는다", async () => {
    const markers = await getChartDisclosureMarkersByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    const aCount = markers.filter((m) => m.disclosureType === "A").length;
    const bCount = markers.filter((m) => m.disclosureType === "B").length;
    expect(aCount + bCount).toBe(markers.length);

    const receiptNos = markers.map((m) => m.receiptNo);
    expect(new Set(receiptNos).size).toBe(receiptNos.length);
  });

  it("존재하지 않는 종목코드는 0건이다", async () => {
    const markers = await getChartDisclosureMarkersByStockCode(
      "999999",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END
    );
    expect(markers).toHaveLength(0);
  });

  it("같은 날짜에 같은 유형(B) 공시가 여러 건이어도 둘 다 남는다", async () => {
    // 2026-06-24에 SK하이닉스가 주요사항보고서를 같은 날 2건 냈다(해외증권
    // 시장주권등상장결정, 유상증자결정) — 실제 응답으로 확인했다. 차트
    // 마커는 날짜당 하나만 찍혀도, 이 데이터 목록 자체에서는 둘 다 있어야
    // 한다(사라지면 안 된다).
    const markers = await getChartDisclosureMarkersByStockCode(
      "000660",
      "20260624",
      "20260624"
    );
    const receiptNos = markers.map((m) => m.receiptNo);
    expect(receiptNos).toContain("20260624000423");
    expect(receiptNos).toContain("20260624000420");
  });
});

describe("OpenDART 응답에서 '공시 없음'과 실제 API 오류를 구분한다", () => {
  it("회사가 존재하기 전 기간처럼 정말 0건이면 에러 없이 빈 배열을 준다 (status 013)", async () => {
    // SK하이닉스의 첫 공시는 1999-03-31이다(실제로 확인함) — 그보다 앞선
    // 기간은 OpenDART가 "조회된 데이타가 없습니다"(013)로 응답한다. 013은
    // 오류가 아니라 정상적인 0건 응답이므로 던지지 않고 빈 배열을 줘야 한다.
    await expect(
      getChartDisclosureMarkersByStockCode("000660", "19990101", "19990102")
    ).resolves.toEqual([]);
  });

  it("잘못된 요청(시작일이 종료일보다 늦음)은 진짜 오류라 던진다 (status 100)", async () => {
    // begin/end를 뒤집으면 OpenDART가 "시작일이 종료일보다 이후 날짜입니다"
    // (status 100, 진짜 오류)로 응답한다 — 실제 응답으로 확인했다. 0건과
    // 달리 이건 예외를 던져야, 화면에서 "공시 없음"과 "요청 실패"를 다른
    // 문구로 구분해 보여줄 수 있다.
    await expect(
      getChartDisclosureMarkersByStockCode("000660", "20260830", "19990101")
    ).rejects.toThrow();
  });
});

// DART 원문 뷰어(dart.fss.or.kr)는 접수번호가 잘못돼도 HTTP 200을 주지만,
// <title>이 "거부"로 온다(실제 응답으로 확인함). 그래서 링크 문자열 모양이
// 아니라 실제로 접속해 그 접수번호의 진짜 보고서가 열리는지를 확인한다.
//
// title은 OpenDART의 report_nm과 글자 하나까지 같지는 않다 — 실제로 확인한
// 두 가지 차이: "[기재정정]" 같은 맨 앞 대괄호 태그가 title에는 없고
// (rcpNo 20260821000615), 정기보고서의 "(1998.12)" 같은 기간 표시도 title
// 에는 없다(rcpNo 19990331000222, report_nm "사업보고서 (1998.12)" → title
// "사업보고서"). 그래서 report_nm과의 완전 일치는 요구하지 않고, "거부"가
// 아닌지 + 실제 회사명이 들어있는지로 그 접수번호의 진짜 문서인지를 확인한다.
async function fetchDartViewerTitle(url: string): Promise<string> {
  const res = await fetch(url);
  expect(res.status).toBe(200);
  const html = await res.text();
  return /<title>([^<]*)<\/title>/.exec(html)?.[1]?.trim() ?? "";
}

describe("모든 공시의 접수번호로 만든 DART 원문 링크가 실제로 접근된다", () => {
  it("SK하이닉스(000660) 최근 공시의 원문 링크마다 실제 그 회사의 문서 페이지가 열린다", async () => {
    const page = await getRecentDisclosuresByStockCode("000660", ONE_YEAR_BEGIN, ONE_YEAR_END, 3);
    expect(page.items.length).toBeGreaterThan(0);

    for (const item of page.items) {
      const title = await fetchDartViewerTitle(item.dartUrl);
      expect(title).not.toBe("거부");
      expect(title).toContain("SK하이닉스");
    }
  });

  it("전체 공시 목록(최근 1년)의 마지막 페이지에서 뽑은 공시도 원문 링크가 실제로 열린다", async () => {
    const first = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      1
    );
    expect(first.totalPage).toBeGreaterThan(0);

    // 접수일 내림차순이므로, 마지막 페이지의 마지막 항목이 이 기간 안에서
    // 가장 오래된 공시다.
    const lastPage = await getDisclosurePageByStockCode(
      "000660",
      ONE_YEAR_BEGIN,
      ONE_YEAR_END,
      first.totalPage
    );
    const oldest = lastPage.items[lastPage.items.length - 1];
    expect(oldest).toBeDefined();

    const title = await fetchDartViewerTitle(oldest.dartUrl);
    expect(title).not.toBe("거부");
    expect(title).toContain("SK하이닉스");
  });

  it("존재하지 않는 접수번호로 만든 링크는 '거부' 페이지로 응답한다 (검증 로직 자체가 실제로 구분하는지 확인)", async () => {
    const title = await fetchDartViewerTitle(
      "https://dart.fss.or.kr/dsaf001/main.do?rcpNo=00000000000000"
    );
    expect(title).toBe("거부");
  });
});
