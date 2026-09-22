import Link from "next/link";
import {
  getLatestStockPriceByCode,
  getLatestStockPrices,
  getYearlyDailyPrices,
} from "@/lib/stock-price-api";
import { subtractDaysYyyyMmDd } from "@/lib/trading-date";
import {
  formatBaseDateLabel,
  formatChange,
  formatChangeRate,
  formatPrice,
  formatTradingValue,
  formatVolume,
} from "@/lib/format";
import { ChangeIndicator } from "@/components/ChangeIndicator";
import { StockChart } from "./StockChart";
import styles from "./stock.module.css";

export const dynamic = "force-dynamic";

export default async function StockDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const [stock, market, yearly] = await Promise.all([
    getLatestStockPriceByCode(code),
    getLatestStockPrices(1),
    getYearlyDailyPrices(code),
  ]);

  if (!stock) {
    return (
      <main className={styles.main}>
        <h1>종목을 찾지 못했습니다</h1>
        <p>종목코드 &ldquo;{code}&rdquo;에 해당하는 시세를 찾지 못했습니다.</p>
        <p>종목명이나 종목코드를 다시 확인해 검색해 보세요.</p>
        <Link href="/">시장 화면으로 돌아가기</Link>
      </main>
    );
  }

  const { basDt, item } = stock;
  const price = Number(item.clpr);
  const change = Number(item.vs);
  const changeRate = Number(item.fltRt);
  // 대비(vs)·등락률(fltRt)은 전일 종가가 아니라 기준가와 비교한 값이다.
  // API가 기준가를 따로 주지 않아 종가에서 대비를 거꾸로 빼서 구한다.
  // 신규 상장 첫날처럼 전일 종가 자체가 없는 날에도 기준가는 있다 — 실제로
  // 0220W0(한화머시너리앤서비스홀딩스) 상장 첫날 데이터로 확인했다: 그날
  // 기준가(종가-대비)는 시가와 같은 10,000원이었고, 이는 상장 기준가였지
  // "전일 종가"가 아니었다.
  const basePrice = price - change;
  const open = Number(item.mkp);
  const high = Number(item.hipr);
  const low = Number(item.lopr);
  const volume = Number(item.trqu);
  const tradingValue = Number(item.trPrc);
  const baseDateDiffers = basDt !== market.basDt;

  // 최근 상장 종목처럼 실제 데이터가 1년치보다 짧을 수 있다. 요청한 시작일
  // 근처(휴장일 며칠 정도는 봐준다)까지 데이터가 있는지로 판단한다.
  const firstBarDate = yearly.bars[0]?.basDt;
  const earliestAcceptableStart = subtractDaysYyyyMmDd(
    yearly.requestedBeginBasDt,
    -7
  );
  const isFullYear = !!firstBarDate && firstBarDate <= earliestAcceptableStart;
  const lastBarDate = yearly.bars[yearly.bars.length - 1]?.basDt;

  return (
    <main className={styles.main}>
      <Link className={styles.backLink} href="/">← 시장 화면으로</Link>
      <form className={styles.searchForm} action="/search" method="get" role="search">
        <input name="q" aria-label="종목명 또는 종목코드" placeholder="종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)" />
        <button type="submit">찾기</button>
      </form>

      <section className={styles.stockHead}>
        <div className={styles.title}>
          <h1>{item.itmsNm}</h1>
          <span className={styles.tag}>{item.mrktCtg}</span>
          <span className={styles.tag}>{item.srtnCd}</span>
        </div>
        <div className={styles.quote}>
          <span className={styles.close}>{price.toLocaleString("ko-KR")}</span>
          <span className={styles.unit}>원</span>
          <ChangeIndicator
            value={change}
            visibleText={`${formatChange(change)} (${formatChangeRate(changeRate)})`}
          />
        </div>
        <div className={styles.baseDateBadge}>
          <span>이 종목 기준일</span>
          <strong>{formatBaseDateLabel(basDt)}</strong>
          <span>{dataLagLabel(basDt)}</span>
        </div>
        {baseDateDiffers && (
          <p className={styles.notice}>
            시장 기준일은 {formatBaseDateLabel(market.basDt)}이지만 이 종목은 {formatBaseDateLabel(basDt)}까지만
            제공됩니다. 두 날짜를 같은 날처럼 읽지 않도록 그대로 표시합니다.
          </p>
        )}
        <dl className={styles.detailGrid}>
          <div>
            <dt>시가</dt>
            <dd>{formatPrice(open)}</dd>
          </div>
          <div>
            <dt>고가</dt>
            <dd>{formatPrice(high)}</dd>
          </div>
          <div>
            <dt>저가</dt>
            <dd>{formatPrice(low)}</dd>
          </div>
          <div>
            <dt>기준가</dt>
            <dd>{formatPrice(basePrice)}</dd>
          </div>
          <div>
            <dt>거래량</dt>
            <dd>{formatVolume(volume)}</dd>
          </div>
          <div>
            <dt>거래대금</dt>
            <dd>{formatTradingValue(tradingValue)}</dd>
          </div>
        </dl>
      </section>

      <section className="chart-card" aria-labelledby="chart-heading">
        <header>
          <h2 id="chart-heading">최근 1년 주가 흐름</h2>
          <span className="note">
            {yearly.bars.length > 0 && firstBarDate && lastBarDate
              ? `${firstBarDate.slice(0, 4)}.${firstBarDate.slice(4, 6)}.${firstBarDate.slice(6, 8)} ~ ${lastBarDate.slice(0, 4)}.${lastBarDate.slice(4, 6)}.${lastBarDate.slice(6, 8)} · 거래일 ${yearly.bars.length}일`
              : "표시할 구간이 없습니다"}
          </span>
        </header>
        {!isFullYear && firstBarDate && lastBarDate && (
          <p className="chart-note">
            이 종목은 최근 1년 구간에 제공된 거래일이 {yearly.bars.length}일뿐입니다.
            1년 흐름이 아니라 있는 구간만 보여 줍니다.
          </p>
        )}
        <StockChart bars={yearly.bars} />
      </section>
    </main>
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
