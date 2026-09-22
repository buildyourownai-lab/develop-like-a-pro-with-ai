import Link from "next/link";
import {
  DISCLOSURE_TYPES,
  FULL_LIST_PAGE_COUNT,
  getDisclosurePageByStockCode,
  getDisclosureTypeCounts,
  isDisclosureTypeCode,
  type DisclosureTypeCode,
} from "@/lib/dart-disclosure-api";
import { getLatestStockPriceByCode } from "@/lib/stock-price-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "@/lib/trading-date";
import styles from "./disclosures.module.css";

export const dynamic = "force-dynamic";

function href(code: string, type?: DisclosureTypeCode, page = 1) {
  const query = new URLSearchParams();
  if (type) query.set("type", type);
  if (page > 1) query.set("page", String(page));
  return `/stocks/${code}/disclosures${query.size ? `?${query}` : ""}`;
}

function pageWindow(current: number, total: number) {
  if (total <= 1) return [];
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from(
    { length: Math.min(5, total) },
    (_, index) => start + index,
  );
}

function shortDate(value: string) {
  return /^\d{8}$/.test(value)
    ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6, 8)}`
    : value;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ page?: string; type?: string }>;
}) {
  const { code } = await params;
  const search = await searchParams;
  const parsedPage = Number(search.page);
  const pageNo =
    Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const type =
    search.type && isDisclosureTypeCode(search.type) ? search.type : undefined;
  const endDate = formatYyyyMmDd(new Date());
  const beginDate = subtractDaysYyyyMmDd(endDate, 365);
  let error = "";
  let data: Awaited<ReturnType<typeof getDisclosurePageByStockCode>> | null =
    null;
  let counts: Awaited<ReturnType<typeof getDisclosureTypeCounts>> = [];
  let company = code;
  try {
    const [page, typeCounts, stock] = await Promise.all([
      getDisclosurePageByStockCode(code, beginDate, endDate, pageNo, {
        disclosureType: type,
      }),
      getDisclosureTypeCounts(code, beginDate, endDate),
      getLatestStockPriceByCode(code),
    ]);
    data = page;
    counts = typeCounts;
    company = stock?.item.itmsNm || code;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  const total = counts.reduce((sum, entry) => sum + entry.count, 0);
  const visibleCounts = counts.filter((entry) => entry.count > 0);
  const first = data?.items.length
    ? (data.pageNo - 1) * FULL_LIST_PAGE_COUNT + 1
    : 0;
  const last = data?.items.length ? first + data.items.length - 1 : 0;
  const typeLabel = type
    ? DISCLOSURE_TYPES.find((entry) => entry.code === type)?.label
    : null;

  return (
    <main className={styles.main}>
      <Link className={styles.backLink} href={`/stocks/${code}`}>
        ← 주가 화면으로
      </Link>
      <form
        className={styles.searchForm}
        action="/search"
        method="get"
        role="search"
      >
        <input
          name="q"
          aria-label="종목명 또는 종목코드"
          placeholder="종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)"
        />
        <button>찾기</button>
      </form>
      {error && (
        <p className={`${styles.card} ${styles.notice}`}>
          <strong>공시를 불러오지 못했습니다</strong>
          {error}
        </p>
      )}
      {data && (
        <>
          <section className={`${styles.card} ${styles.filingHead}`}>
            <h1>
              {company} 공시 전체 <span className={styles.tag}>{code}</span>
            </h1>
            <p className={styles.filingRange}>
              {shortDate(data.beginDate)} ~ {shortDate(data.endDate)} 접수분 ·
              이 화면은 순서를 매기거나 골라내지 않고 OpenDART가 준 목록을
              그대로 보여 줍니다.
            </p>
            <p className={styles.filingTotal}>
              이 기간에 접수된 공시는{" "}
              <strong>{total.toLocaleString("ko-KR")}건</strong>입니다. 아래
              유형 구분은 OpenDART 공시유형입니다.
            </p>
            <nav
              className={styles.filingTypes}
              aria-label="공시유형으로 좁혀 보기"
            >
              <Link className={!type ? styles.on : ""} href={href(code)}>
                전체 <b>{total.toLocaleString("ko-KR")}</b>
              </Link>
              {visibleCounts.map((entry) => (
                <Link
                  className={entry.code === type ? styles.on : ""}
                  key={entry.code}
                  href={href(code, entry.code)}
                >
                  {entry.label} <b>{entry.count.toLocaleString("ko-KR")}</b>
                </Link>
              ))}
            </nav>
            {visibleCounts.length < DISCLOSURE_TYPES.length && (
              <p className={styles.filingNote}>
                이 기간에 0건인 유형은 버튼으로 만들지 않았습니다. OpenDART
                공시유형은 모두 {DISCLOSURE_TYPES.length}가지입니다.
              </p>
            )}
          </section>
          <section className={`${styles.card} ${styles.tableCard}`}>
            <header>
              <h2>
                {typeLabel
                  ? `${typeLabel} ${data.totalCount.toLocaleString("ko-KR")}건`
                  : "공시 목록"}
              </h2>
              <span>
                {data.totalCount
                  ? `${data.totalCount.toLocaleString("ko-KR")}건 중 ${first.toLocaleString("ko-KR")}~${last.toLocaleString("ko-KR")}번째 · ${data.pageNo}/${data.totalPage} 페이지`
                  : "표시할 공시가 없습니다"}
              </span>
            </header>
            {!data.items.length ? (
              <p className={styles.filingNote}>
                이 조건으로 접수된 공시가 없습니다.
              </p>
            ) : (
              <table className={styles.filingTable}>
                <thead>
                  <tr>
                    <th>접수일</th>
                    <th>보고서명</th>
                    <th>제출인</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((item) => (
                    <tr key={item.receiptNo}>
                      <td className={styles.date}>
                        {shortDate(item.receiptDate)}
                      </td>
                      <td>
                        <a
                          href={item.dartUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {item.reportName} ↗
                          <span className={styles.visuallyHidden}>
                            {" "}
                            DART 원문 새 창에서 열기
                          </span>
                        </a>
                      </td>
                      <td>{item.submitter}</td>
                      <td className={styles.noteCell}>{item.remarks || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pageWindow(data.pageNo, data.totalPage).length > 1 && (
              <nav className={styles.pager} aria-label="공시 목록 페이지">
                {data.pageNo > 1 && (
                  <Link href={href(code, type, data.pageNo - 1)}>이전</Link>
                )}
                {pageWindow(data.pageNo, data.totalPage).map((number) =>
                  number === data.pageNo ? (
                    <span className={styles.currentPage} key={number}>
                      {number}
                    </span>
                  ) : (
                    <Link key={number} href={href(code, type, number)}>
                      {number}
                    </Link>
                  ),
                )}
                {data.pageNo < data.totalPage && (
                  <Link href={href(code, type, data.pageNo + 1)}>다음</Link>
                )}
              </nav>
            )}
          </section>
          <footer className={styles.footer}>
            <p>공시 출처: 금융감독원 전자공시시스템(OpenDART) 공시검색.</p>
            <p>
              보고서명·접수일·제출인·비고는 OpenDART가 준 값을 그대로
              표시합니다. DART 원문이 최종 근거입니다.
            </p>
            <p>
              유형 구분은 OpenDART 공시유형이며, 이 화면은 중요도를 판단하거나
              순위를 매기지 않습니다.
            </p>
          </footer>
        </>
      )}
    </main>
  );
}
