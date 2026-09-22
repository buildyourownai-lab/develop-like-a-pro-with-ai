import { formatPrice, formatTradeValue } from "@/lib/format";
import { getMarketSnapshot } from "@/lib/market";
import { RANKING_RULE_TEXT } from "@/lib/movers";
import { formatBaseDate } from "@/lib/trading-date";
import { MoverCard } from "@/components/mover-card";
import { BaseDateBadge, ChangeFigure, SearchBar, SourceFootnote } from "@/components/ui";

/**
 * 이 화면을 build 때 미리 만들지 않는다.
 * 미리 만들면 build가 금융위원회 API 응답에 매달리고, 잠깐 통신이 끊겨도 build 자체가 실패한다.
 * 요청이 올 때 만들고, 자료는 fscFetch의 10분 revalidate로 재사용한다.
 */
export const dynamic = "force-dynamic";

export default async function MarketPage() {
  const snapshot = await getMarketSnapshot();
  const indexDatesDiffer = snapshot.indices.some((index) => index.baseDate !== snapshot.priceBaseDate);

  return (
    <>
      <div className="masthead">
        <div>
          <h1>국내 주식 한눈에</h1>
          <p>금융위원회가 제공하는 공식 주식 데이터로 국내 증시를 확인합니다.</p>
        </div>
        <BaseDateBadge label="주식시세 기준일" baseDate={snapshot.priceBaseDate} />
      </div>

      <SearchBar />

      <section className="section">
        <div className="section-head">
          <h2>시장 현황</h2>
          {snapshot.indexBaseDate && (
            <span className="note">지수 기준일 {formatBaseDate(snapshot.indexBaseDate)}</span>
          )}
        </div>

        {indexDatesDiffer && (
          <p className="note" style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13 }}>
            지수시세정보와 주식시세정보의 기준일이 다릅니다. 화면 위의 기준일을 구분해 읽어 주세요.
          </p>
        )}

        {snapshot.indices.length === 0 ? (
          <p className="card notice">지수 자료를 받지 못했습니다.</p>
        ) : (
          <div className="grid-2">
            {snapshot.indices.map((index) => (
              <article key={index.name} className="card index-card" data-testid="index-card">
                <div className="name">{index.name}</div>
                <div className="close">{formatPrice(index.close)}</div>
                <ChangeFigure diff={index.diff} rate={index.changeRate} />
                <div className="sub">
                  <span>
                    시가 {formatPrice(index.open)} · 고가 {formatPrice(index.high)} · 저가{" "}
                    {formatPrice(index.low)}
                  </span>
                  <span>거래대금 {formatTradeValue(index.tradeValue)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>{formatBaseDate(snapshot.priceBaseDate)} 상승·하락률 순위</h2>
          <span className="note">
            전체 {snapshot.universeCount.toLocaleString("ko-KR")}종목 중 {snapshot.rankedCount.toLocaleString("ko-KR")}
            종목을 대상으로 집계했습니다
          </span>
        </div>

        <p className="note" style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13 }}>
          이 서비스에서는 등락률을 기준으로 종목을 정렬합니다. 상승률 상위에는 많이 오른 종목을, 하락률 상위에는
          많이 내린 종목을 보여 줍니다.
        </p>

        <div className="movers">
          <MoverCard
            testId="gainers"
            title="상승률 상위"
            baseDate={snapshot.priceBaseDate}
            quotes={snapshot.gainers}
          />
          <MoverCard
            testId="losers"
            title="하락률 상위"
            baseDate={snapshot.priceBaseDate}
            quotes={snapshot.losers}
          />
        </div>
      </section>

      <SourceFootnote extra={[`순위 집계 조건: ${RANKING_RULE_TEXT.join(", ")}`]} />
    </>
  );
}
