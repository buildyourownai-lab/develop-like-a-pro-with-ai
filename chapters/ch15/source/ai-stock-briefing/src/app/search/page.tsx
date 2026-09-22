import Link from "next/link";
import { redirect } from "next/navigation";
import { searchListedStocksWithBaseDate } from "@/lib/krx-listed-info-api";
import { formatBaseDateLabel } from "@/lib/format";
import styles from "./search.module.css";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const query = ((await searchParams).q ?? "").trim();

  if (!query) {
    return (
      <main className={styles.main}>
        <BackToMarket />
        <SearchForm />
        <p className={styles.notice}>
          <strong>찾고 싶은 종목을 입력해 주세요</strong>
          종목명 또는 종목코드로 찾을 수 있습니다. (예: SK하이닉스, 000660)
        </p>
      </main>
    );
  }

  const { baseDate, results } = await searchListedStocksWithBaseDate(query);
  if (results.length === 1) redirect(`/stocks/${results[0].code}`);

  return (
    <main className={styles.main}>
      <BackToMarket />
      <SearchForm defaultValue={query} />

      <div className={styles.sectionHead}>
        <h2>“{query}” 검색 결과 {results.length}건</h2>
        {baseDate && (
          <span className={styles.baseDateBadge}>
            <span>상장종목 기준일</span>
            <strong>{formatBaseDateLabel(baseDate)}</strong>
            <span>{dataLagLabel(baseDate)}</span>
          </span>
        )}
      </div>

      {results.length === 0 ? (
        <p className={styles.notice}>
          <strong>일치하는 상장종목이 없습니다</strong>
          {formatBaseDateLabel(baseDate)} 기준 KRX 상장종목정보에서 “{query}”를 찾지 못했습니다.
          종목명 전체나 여섯 자리 종목코드로 다시 시도해 주세요.
        </p>
      ) : (
        <div className={styles.resultCard}>
          {results.map((result) => (
            <Link className={styles.resultRow} href={`/stocks/${result.code}`} key={result.code}>
              <span>
                <strong>{result.name}</strong>
                <small>{result.corpName}</small>
              </span>
              <span className={styles.tags}>
                <span>{result.market}</span>
                <span>{result.code}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <footer className={styles.footer}>
        <p>출처: 금융위원회 KRX상장종목정보 (공공데이터포털)</p>
        <p>실시간 시세가 아니라 공공데이터포털이 제공한 가장 최근 거래일 자료입니다.</p>
        <p>투자 판단이나 추천을 제공하지 않습니다.</p>
      </footer>
    </main>
  );
}

function BackToMarket() {
  return <Link className={styles.backLink} href="/">← 시장 화면으로</Link>;
}

function SearchForm({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form className={styles.searchForm} action="/search" method="get" role="search">
      <label className={styles.visuallyHidden} htmlFor="search-query">종목명 또는 종목코드</label>
      <input id="search-query" name="q" defaultValue={defaultValue}
        placeholder="종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)" />
      <button type="submit">찾기</button>
    </form>
  );
}

function dataLagLabel(baseDate: string): string {
  if (!/^\d{8}$/.test(baseDate)) return "";
  const date = Date.UTC(Number(baseDate.slice(0, 4)), Number(baseDate.slice(4, 6)) - 1, Number(baseDate.slice(6, 8)));
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.floor((today - date) / 86_400_000));
  return days === 0 ? "당일 제공" : `${days}일 전 자료`;
}
