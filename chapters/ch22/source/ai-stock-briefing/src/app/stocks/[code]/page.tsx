import Link from "next/link";

import { fetchFilings, fetchFilingsByTypes, findCorpByStockCode } from "@/lib/dart";
import { CHART_MARKER_RULE_TEXT, CHART_MARKER_TYPES, toFilingMarkers } from "@/lib/filings";
import { formatPrice, formatTradeValue, formatVolume } from "@/lib/format";
import { resolveLatestPriceBaseDate } from "@/lib/market";
import { fetchStockHistory, isValidCode, normalizeCode } from "@/lib/stock";
import { formatBaseDate, formatShortDate, seoulToday } from "@/lib/trading-date";
import type { DailyBar, Filing, FilingMarker } from "@/lib/types";
import { BaseDateBadge, ChangeFigure, SearchBar, SourceFootnote } from "@/components/ui";

import { PriceChart } from "./price-chart";
import { BriefingPanel } from "./briefing-panel";

export const revalidate = 600;

/** 1년이면 거래일이 240일 안팎이다. 이보다 크게 짧으면 구간이 짧다고 알려 준다. */
const SHORT_HISTORY_DAYS = 200;

/** 종목 화면에서는 최근 공시 몇 건만 보여 주고, 전체는 공시 화면으로 넘긴다. */
const RECENT_FILING_ROWS = 5;

type FilingSection =
  | { state: "none" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      corpName: string;
      from: string;
      to: string;
      totalCount: number;
      recent: Filing[];
      markers: FilingMarker[];
      markerCount: number;
      afterChartCount: number;
    };

/**
 * 공시는 시세와 다른 곳(OpenDART)에서 온다.
 * 공시를 못 가져와도 9장에서 만든 가격 화면은 그대로 보여야 하므로 실패를 여기서 흡수한다.
 */
async function loadFilingSection(code: string, bars: DailyBar[]): Promise<FilingSection> {
  if (bars.length === 0) {
    return { state: "none" };
  }
  try {
    const corp = await findCorpByStockCode(code);
    if (!corp) {
      return { state: "none" };
    }

    const from = bars[0].date;
    const to = seoulToday();
    const [all, marked] = await Promise.all([
      fetchFilings({ corpCode: corp.corpCode, from, to, pageNo: 1, pageCount: RECENT_FILING_ROWS }),
      fetchFilingsByTypes({ corpCode: corp.corpCode, from, to, typeCodes: CHART_MARKER_TYPES }),
    ]);

    const { markers, afterChartCount } = toFilingMarkers(
      marked,
      bars.map((bar) => bar.date)
    );

    return {
      state: "ready",
      corpName: corp.corpName,
      from,
      to,
      totalCount: all.totalCount,
      recent: all.filings,
      markers,
      markerCount: marked.length,
      afterChartCount,
    };
  } catch (caught) {
    return { state: "error", message: caught instanceof Error ? caught.message : "공시를 불러오지 못했습니다." };
  }
}

export default async function StockPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode(decodeURIComponent((await params).code).toUpperCase());

  if (!isValidCode(code)) {
    return (
      <Shell>
        <p className="card notice">
          <strong>종목코드 형식이 올바르지 않습니다</strong>
          여섯 자리 종목코드로 다시 시도해 주세요. (예: 000660)
        </p>
      </Shell>
    );
  }

  const priceBaseDate = await resolveLatestPriceBaseDate();
  const { quote, bars } = await fetchStockHistory(code, priceBaseDate);

  if (!quote) {
    return (
      <Shell>
        <p className="card notice">
          <strong>{code} 종목의 시세를 찾지 못했습니다</strong>
          최근 1년 구간에 금융위원회 주식시세정보로 제공된 자료가 없습니다. 상장폐지·거래정지 종목이거나 종목코드가
          다를 수 있습니다.
        </p>
      </Shell>
    );
  }

  /**
   * 금융위원회 주식시세정보는 등락(vs)과 등락률(fltRt)을 기준가와 비교해 준다.
   * 기준가는 대개 전일 종가지만, 유·무상증자나 권리락·액면분할이 있으면 조정된 가격이다.
   * 그래서 이 값을 "전일 종가"라고 부르지 않고 기준가로 표시한다.
   */
  const basePrice = quote.close - quote.diff;
  const staleQuote = quote.baseDate !== priceBaseDate;
  const filings = await loadFilingSection(code, bars);

  return (
    <Shell>
      <section className="card stock-head">
        <div className="title">
          <h1>{quote.name}</h1>
          <span className="tag">{quote.market}</span>
          <span className="tag">{quote.code}</span>
        </div>

        <div className="quote">
          <span className="close">{formatPrice(quote.close)}</span>
          <span className="unit">원</span>
          <ChangeFigure diff={quote.diff} rate={quote.changeRate} />
        </div>

        <div style={{ marginTop: 12 }}>
          <BaseDateBadge label="이 종목 기준일" baseDate={quote.baseDate} />
        </div>

        {staleQuote && (
          <p style={{ margin: "10px 0 0", color: "var(--muted)", fontSize: 13 }}>
            시장 기준일은 {formatBaseDate(priceBaseDate)}이지만 이 종목은 {formatBaseDate(quote.baseDate)}까지만
            제공됩니다. 두 날짜를 같은 날처럼 읽지 않도록 그대로 표시합니다.
          </p>
        )}

        <dl className="figure-grid" data-testid="figure-grid">
          <div>
            <dt>시가</dt>
            <dd>{formatPrice(quote.open)}원</dd>
          </div>
          <div>
            <dt>고가</dt>
            <dd>{formatPrice(quote.high)}원</dd>
          </div>
          <div>
            <dt>저가</dt>
            <dd>{formatPrice(quote.low)}원</dd>
          </div>
          <div>
            <dt>기준가</dt>
            <dd>{formatPrice(basePrice)}원</dd>
          </div>
          <div>
            <dt>거래량</dt>
            <dd>{formatVolume(quote.volume)}</dd>
          </div>
          <div>
            <dt>거래대금</dt>
            <dd>{formatTradeValue(quote.tradeValue)}</dd>
          </div>
        </dl>
      </section>

      <section className="card chart-card" data-testid="price-chart">
        <header>
          <h2>최근 1년 주가 흐름</h2>
          <span className="note">
            {bars.length > 0
              ? `${formatShortDate(bars[0].date)} ~ ${formatShortDate(bars[bars.length - 1].date)} · 거래일 ${bars.length}일`
              : "표시할 구간이 없습니다"}
          </span>
        </header>
        {/* 최근 상장 종목은 1년치가 아예 없다. 1년인 척하지 않고 실제 구간을 그대로 알려 준다. */}
        {bars.length > 0 && bars.length < SHORT_HISTORY_DAYS && (
          <p className="chart-note">
            이 종목은 최근 1년 구간에 제공된 거래일이 {bars.length}일뿐입니다. 1년 흐름이 아니라 있는 구간만
            보여 줍니다.
          </p>
        )}
        <PriceChart bars={bars} markers={filings.state === "ready" ? filings.markers : []} />
        {filings.state === "ready" && filings.markers.length > 0 && (
          <p className="chart-note filing-marker-note">
            차트에는 정기공시와 주요사항보고 {filings.markerCount}건을 골라, 같은 날 공시를 묶어{" "}
            {filings.markers.length}개 거래일에 표시했습니다.
            {"\n"}{CHART_MARKER_RULE_TEXT}
          </p>
        )}
      </section>

      <FilingCard code={code} filings={filings} />

      <BriefingPanel code={code} />

      <SourceFootnote
        extra={[
          "일별 시세는 금융위원회 주식시세정보의 일봉(시가·고가·저가·종가·거래량·거래대금)입니다.",
          "봉의 색은 그날의 시가와 종가를 비교해 표시합니다. 반면 등락과 등락률은 기준가와 비교한 값이라 둘의 비교 기준은 다릅니다.",
          "기준가는 대개 전일 종가이지만, 유·무상증자나 권리락·액면분할이 있으면 조정된 가격입니다.",
          ...(filings.state === "ready"
            ? [
                "공시 출처: 금융감독원 전자공시시스템(OpenDART) 공시검색. 화면의 요약이 아니라 DART 원문이 최종 근거입니다.",
                "공시가 주가 움직임의 원인이라는 뜻이 아닙니다. 같은 기간에 있었던 일을 같은 시간축에 놓고 보는 것입니다.",
              ]
            : []),
        ]}
      />
    </Shell>
  );
}

function FilingCard({ code, filings }: { code: string; filings: FilingSection }) {
  if (filings.state === "none") {
    return null;
  }

  if (filings.state === "error") {
    return (
      <section className="card filing-card" data-testid="filing-card">
        <header>
          <h2>이 회사 관련 공시</h2>
        </header>
        <p className="notice error">
          <strong>공시를 불러오지 못했습니다</strong>
          {filings.message} 가격 자료는 그대로 표시되어 있습니다.
        </p>
      </section>
    );
  }

  return (
    <section className="card filing-card" data-testid="filing-card">
      <header>
        <h2>이 회사 관련 공시</h2>
        <span className="note">
          {formatShortDate(filings.from)} ~ {formatShortDate(filings.to)} 접수분
        </span>
      </header>

      <p className="filing-total" data-testid="filing-total">
        이 기간에 접수된 공시는 <strong>{filings.totalCount.toLocaleString("ko-KR")}건</strong>입니다.
        {filings.totalCount > RECENT_FILING_ROWS && " 아래는 그중 가장 최근 것들입니다."}
      </p>

      {filings.recent.length === 0 ? (
        <p className="chart-note">이 기간에 접수된 공시가 없습니다.</p>
      ) : (
        <ul className="filing-list">
          {filings.recent.map((filing) => (
            <li key={filing.receiptNo}>
              <span className="filing-date">{formatShortDate(filing.receiptDate)}</span>
              <a
                className="filing-name"
                href={filing.documentUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {filing.reportName} <span aria-hidden="true">↗</span>
                <span className="visually-hidden">DART 원문 새 창에서 열기</span>
              </a>
              <span className="filing-filer">제출인: {filing.filerName}</span>
            </li>
          ))}
        </ul>
      )}

      <Link className="filing-more" href={`/stocks/${code}/filings`}>
        공시 {filings.totalCount.toLocaleString("ko-KR")}건 전체 보기
      </Link>
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Link className="back-link" href="/">
        <span aria-hidden="true">←</span> 시장 화면으로
      </Link>
      <SearchBar />
      {children}
    </>
  );
}
