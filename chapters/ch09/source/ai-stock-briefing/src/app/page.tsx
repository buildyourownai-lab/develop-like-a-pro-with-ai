import Link from "next/link";
import { getMarketOverview } from "@/lib/market";
import type { RankedStock } from "@/lib/market";
import {
  formatBaseDateLabel,
  formatChange,
  formatChangeRate,
  formatPrice,
  formatTradingValue,
} from "@/lib/format";
import { ChangeIndicator } from "@/components/ChangeIndicator";
import styles from "./page.module.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  const overview = await getMarketOverview();
  const viewedAt = new Date().toLocaleString("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const indexBaseDate = overview.indices[0]?.baseDate;
  const baseDatesDiffer =
    indexBaseDate !== undefined && indexBaseDate !== overview.stockBaseDate;
  const baseDateUtc = Date.UTC(
    Number(overview.stockBaseDate.slice(0, 4)),
    Number(overview.stockBaseDate.slice(4, 6)) - 1,
    Number(overview.stockBaseDate.slice(6, 8))
  );
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const lag = Math.max(0, Math.floor((todayUtc - baseDateUtc) / 86_400_000));

  return (
    <div className={styles.page}>
      <header className={styles.masthead}>
        <div>
          <h1>국내 주식 한눈에</h1>
          <p>금융위원회가 제공하는 공식 주식 데이터로 국내 증시를 확인합니다.</p>
        </div>
        <span className={styles.basedate}>
          <span>주식시세 기준일</span>
          <strong>{formatBaseDateLabel(overview.stockBaseDate)}</strong>
          <span>  {lag === 0 ? "당일 제공" : `${lag}일 전 자료`}</span>
        </span>
      </header>

      <main className={styles.main}>
        <form className={styles.searchForm} action="/search" method="get" role="search">
          <label className={styles.visuallyHidden} htmlFor="stock-search">
            종목명 또는 종목코드
          </label>
          <input
            id="stock-search"
            name="q"
            type="search"
            placeholder="종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)"
          />
          <button type="submit">찾기</button>
        </form>

        <section aria-labelledby="index-heading">
          <div className={styles.sectionHead}>
            <h2 id="index-heading">시장 현황</h2>
            {indexBaseDate && (
              <span>지수 기준일 {formatBaseDateLabel(indexBaseDate)}</span>
            )}
          </div>
          {baseDatesDiffer && indexBaseDate && (
            <p className={styles.notice}>
              지수 기준일({formatBaseDateLabel(indexBaseDate)})과 종목 시세
              기준일({formatBaseDateLabel(overview.stockBaseDate)})이 다릅니다.
            </p>
          )}
          <div className={styles.indexGrid}>
            {overview.indices.map((idx) => (
              <article key={idx.name} className={styles.indexCard}>
                <h3>{idx.name}</h3>
                <p className={styles.indexValue}>{idx.value.toLocaleString("ko-KR")}</p>
                <p>
                  <ChangeIndicator
                    value={idx.change}
                    visibleText={`${formatChange(idx.change)} (${formatChangeRate(idx.changeRate)})`}
                  />
                </p>
                <p className={styles.indexMeta}>
                  <span>시가 {idx.open.toLocaleString("ko-KR")} · 고가 {idx.high.toLocaleString("ko-KR")} · 저가 {idx.low.toLocaleString("ko-KR")}</span>
                  <span>거래대금 {formatTradingValue(idx.tradingValue)}</span>
                </p>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="ranking-heading">
          <div className={styles.sectionHead}>
            <h2 id="ranking-heading">
              {formatBaseDateLabel(overview.stockBaseDate)} 상승·하락률 순위
            </h2>
            <span>
              전체 {overview.totalStockCount.toLocaleString("ko-KR")}종목 중{" "}
              {overview.eligibleStockCount.toLocaleString("ko-KR")}종목을 대상으로 집계했습니다
            </span>
          </div>
          <p className={styles.rankingGuide}>
            이 서비스에서는 등락률을 기준으로 종목을 정렬합니다. 상승률 상위에는 많이 오른 종목을,
            하락률 상위에는 많이 내린 종목을 보여 줍니다.
          </p>
          <div className={styles.rankingGrid}>
            <RankingCard title="상승률 상위" baseDate={overview.stockBaseDate} stocks={overview.topGainers} />
            <RankingCard title="하락률 상위" baseDate={overview.stockBaseDate} stocks={overview.topLosers} />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <p>이 화면은 {viewedAt}에 조회한 결과입니다.</p>
        <p>
          출처: 공공데이터포털 금융위원회 주식시세정보·지수시세정보·KRX상장종목정보
        </p>
        <p className={styles.condition}>
          순위 집계 조건: {overview.rankingCondition}
        </p>
        <p>실시간 시세나 투자 판단·추천을 제공하지 않습니다.</p>
      </footer>
    </div>
  );
}

function RankingCard({ title, baseDate, stocks }: { title: string; baseDate: string; stocks: RankedStock[] }) {
  return (
    <section className={styles.rankingCard}>
      <h3><span>{title}</span><small>{formatBaseDateLabel(baseDate)} 기준</small></h3>
      <div>
        {stocks.map((stock, index) => (
          <Link className={styles.rankingRow} href={`/stocks/${stock.code}`} key={stock.code}>
            <span className={styles.rank}>{index + 1}</span>
            <span className={styles.stockIdentity}>
              <strong>{stock.name}</strong>
              <small>{stock.code} · {stock.market} · 거래대금 {formatTradingValue(stock.tradingValue)}</small>
            </span>
            <span className={styles.stockFigures}>
              <strong>{formatPrice(stock.price)}</strong>
              <span className={styles.ratePill}>
                <ChangeIndicator value={stock.changeRate} visibleText={formatChangeRate(stock.changeRate)} />
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
