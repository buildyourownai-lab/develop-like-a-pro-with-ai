import Link from "next/link";

import { FILINGS_PAGE_SIZE, fetchFilingTypeCounts, fetchFilings, findCorpByStockCode } from "@/lib/dart";
import {
  DISCLOSURE_TYPES,
  disclosureTypeLabel,
  isDisclosureTypeCode,
  pageWindow,
  sortTypeCounts,
} from "@/lib/filings";
import { isValidCode, normalizeCode } from "@/lib/stock";
import { formatShortDate, seoulToday, shiftYears } from "@/lib/trading-date";
import { SearchBar, SourceFootnote } from "@/components/ui";

export const revalidate = 600;

type Search = { page?: string; type?: string };

/** 주소창의 값은 사람이 손으로 고칠 수 있다. 페이지 번호는 1 이상 정수만 받는다. */
function readPageNo(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** 유형은 OpenDART가 정한 코드만 받는다. 우리가 만든 값은 없다. */
function readTypeCode(raw: string | undefined): string | null {
  return raw && isDisclosureTypeCode(raw) ? raw : null;
}

function linkTo(code: string, typeCode: string | null, pageNo: number): string {
  const query = new URLSearchParams();
  if (typeCode) {
    query.set("type", typeCode);
  }
  if (pageNo > 1) {
    query.set("page", String(pageNo));
  }
  const suffix = query.toString();
  return `/stocks/${code}/filings${suffix ? `?${suffix}` : ""}`;
}

type FilingsView =
  | { state: "no-corp" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      corpName: string;
      page: Awaited<ReturnType<typeof fetchFilings>>;
      typeCounts: Awaited<ReturnType<typeof fetchFilingTypeCounts>>;
    };

/**
 * 화면을 만드는 일과 자료를 가져오는 일을 나눠 둔다.
 * OpenDART가 실패했을 때 무엇을 보여 줄지는 이 함수의 결과로만 정해진다.
 */
async function loadFilingsView(
  code: string,
  from: string,
  to: string,
  pageNo: number,
  typeCode: string | null
): Promise<FilingsView> {
  try {
    const corp = await findCorpByStockCode(code);
    if (!corp) {
      return { state: "no-corp" };
    }
    const [page, typeCounts] = await Promise.all([
      fetchFilings({
        corpCode: corp.corpCode,
        from,
        to,
        pageNo,
        pageCount: FILINGS_PAGE_SIZE,
        ...(typeCode ? { typeCode } : {}),
      }),
      fetchFilingTypeCounts({ corpCode: corp.corpCode, from, to }),
    ]);
    return { state: "ready", corpName: corp.corpName, page, typeCounts };
  } catch (caught) {
    return {
      state: "error",
      message: caught instanceof Error ? caught.message : "OpenDART 요청이 실패했습니다.",
    };
  }
}

export default async function FilingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Search>;
}) {
  const code = normalizeCode(decodeURIComponent((await params).code).toUpperCase());
  const search = await searchParams;
  const pageNo = readPageNo(search.page);
  const typeCode = readTypeCode(search.type);

  if (!isValidCode(code)) {
    return (
      <Shell code={code}>
        <p className="card notice">
          <strong>종목코드 형식이 올바르지 않습니다</strong>
          여섯 자리 종목코드로 다시 시도해 주세요. (예: 000660)
        </p>
      </Shell>
    );
  }

  const to = seoulToday();
  const from = shiftYears(to, -1);
  const view = await loadFilingsView(code, from, to, pageNo, typeCode);

  if (view.state === "no-corp") {
    return (
      <Shell code={code}>
        <p className="card notice">
          <strong>{code} 종목의 회사를 OpenDART에서 찾지 못했습니다</strong>
          OpenDART 고유번호 파일에 이 종목코드로 등록된 회사가 없습니다.
        </p>
      </Shell>
    );
  }

  if (view.state === "error") {
    return (
      <Shell code={code}>
        <p className="card notice error">
          <strong>공시를 불러오지 못했습니다</strong>
          {view.message}
        </p>
      </Shell>
    );
  }

  const { corpName, page, typeCounts } = view;
  const visibleCounts = sortTypeCounts(typeCounts);
  const allCount = typeCounts.reduce((sum, entry) => sum + entry.count, 0);
  const pages = pageWindow(page.pageNo, page.totalPage);
  const firstRow = page.filings.length === 0 ? 0 : (page.pageNo - 1) * FILINGS_PAGE_SIZE + 1;
  const lastRow = firstRow === 0 ? 0 : firstRow + page.filings.length - 1;

  return (
    <Shell code={code}>
      <section className="card filing-head">
        <h1>
          {corpName} 공시 전체
          <span className="tag">{code}</span>
        </h1>
        <p className="filing-range">
          {formatShortDate(from)} ~ {formatShortDate(to)} 접수분 · 이 화면은 순서를 매기거나 골라내지 않고 OpenDART가
          준 목록을 그대로 보여 줍니다.
        </p>

        {/*
          465건이 한 덩어리로 보이면 읽을 수 없다.
          그래서 OpenDART 공시유형별 건수를 먼저 보여 주고, 그 유형으로 좁혀 볼 수 있게 한다.
          유형은 우리가 나눈 것이 아니라 OpenDART가 정해 둔 구분이다.
        */}
        <p className="filing-total" data-testid="filing-total">
          이 기간에 접수된 공시는 <strong>{allCount.toLocaleString("ko-KR")}건</strong>입니다. 아래 유형 구분은
          OpenDART 공시유형입니다.
        </p>

        <div className="filing-types" data-testid="filing-types">
          <Link className={typeCode ? "" : "on"} href={linkTo(code, null, 1)}>
            전체 <b>{allCount.toLocaleString("ko-KR")}</b>
          </Link>
          {visibleCounts.map((entry) => (
            <Link
              key={entry.code}
              className={typeCode === entry.code ? "on" : ""}
              href={linkTo(code, entry.code, 1)}
            >
              {entry.label} <b>{entry.count.toLocaleString("ko-KR")}</b>
            </Link>
          ))}
        </div>
        {visibleCounts.length < DISCLOSURE_TYPES.length && (
          <p className="filing-note">
            이 기간에 0건인 유형은 버튼으로 만들지 않았습니다. OpenDART 공시유형은 모두{" "}
            {DISCLOSURE_TYPES.length}가지입니다.
          </p>
        )}
      </section>

      <section className="card filing-table-card" data-testid="filing-table-card">
        <header>
          <h2>
            {typeCode ? `${disclosureTypeLabel(typeCode)} ${page.totalCount.toLocaleString("ko-KR")}건` : "공시 목록"}
          </h2>
          <span className="note">
            {page.totalCount === 0
              ? "표시할 공시가 없습니다"
              : `${page.totalCount.toLocaleString("ko-KR")}건 중 ${firstRow.toLocaleString("ko-KR")}~${lastRow.toLocaleString("ko-KR")}번째 · ${page.pageNo}/${page.totalPage} 페이지`}
          </span>
        </header>

        {page.filings.length === 0 ? (
          <p className="filing-note">이 조건으로 접수된 공시가 없습니다.</p>
        ) : (
          <table className="filing-table">
            <thead>
              <tr>
                <th scope="col">접수일</th>
                <th scope="col">보고서명</th>
                <th scope="col">제출인</th>
                <th scope="col">비고</th>
              </tr>
            </thead>
            <tbody>
              {page.filings.map((filing) => (
                <tr key={filing.receiptNo} data-testid="filing-row">
                  <td className="date">{formatShortDate(filing.receiptDate)}</td>
                  <td>
                    <a href={filing.documentUrl} target="_blank" rel="noreferrer noopener">
                      {filing.reportName} <span aria-hidden="true">↗</span>
                      <span className="visually-hidden">DART 원문 새 창에서 열기</span>
                    </a>
                  </td>
                  <td>{filing.filerName}</td>
                  <td className="note-cell">
                    {filing.noteLabels.length > 0 ? filing.noteLabels.join(" · ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pages.length > 1 && (
          <nav className="filing-pager" aria-label="공시 목록 페이지">
            {page.pageNo > 1 && (
              <Link href={linkTo(code, typeCode, page.pageNo - 1)} rel="prev">
                이전
              </Link>
            )}
            {pages.map((number) =>
              number === page.pageNo ? (
                <span key={number} aria-current="page">
                  {number}
                </span>
              ) : (
                <Link key={number} href={linkTo(code, typeCode, number)}>
                  {number}
                </Link>
              )
            )}
            {page.pageNo < page.totalPage && (
              <Link href={linkTo(code, typeCode, page.pageNo + 1)} rel="next">
                다음
              </Link>
            )}
          </nav>
        )}
      </section>

      <SourceFootnote
        extra={[
          "공시 출처: 금융감독원 전자공시시스템(OpenDART) 공시검색.",
          "보고서명·접수일·제출인·비고는 OpenDART가 준 값을 그대로 표시합니다. 화면의 요약이 아니라 DART 원문이 최종 근거입니다.",
          "유형 구분은 OpenDART 공시유형이며, 이 화면은 중요도를 판단하거나 순위를 매기지 않습니다.",
          "지분공시의 제출인에는 개인 이름이 그대로 표시될 수 있습니다. OpenDART가 공개한 값입니다.",
        ]}
      />
    </Shell>
  );
}

function Shell({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <>
      <Link className="back-link" href={`/stocks/${code}`}>
        <span aria-hidden="true">←</span> 주가 화면으로
      </Link>
      <SearchBar />
      {children}
    </>
  );
}
