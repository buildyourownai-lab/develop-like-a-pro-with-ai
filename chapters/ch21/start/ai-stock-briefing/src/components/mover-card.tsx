import Link from "next/link";

import { formatPrice, formatTradeValue } from "@/lib/format";
import { formatBaseDate } from "@/lib/trading-date";
import type { StockQuote } from "@/lib/types";

import { RatePill } from "./ui";

export function MoverCard({
  title,
  baseDate,
  quotes,
  testId,
}: {
  title: string;
  baseDate: string;
  quotes: StockQuote[];
  testId: string;
}) {
  return (
    <section className="card mover-card" data-testid={testId}>
      <header>
        <h3>{title}</h3>
        <span className="basis">{formatBaseDate(baseDate)} 기준</span>
      </header>
      {quotes.length === 0 ? (
        <p className="notice">이 기준일에는 조건에 맞는 종목이 없습니다.</p>
      ) : (
        quotes.map((quote, index) => (
          <Link
            key={quote.code}
            className="mover-row"
            href={`/stocks/${quote.code}`}
            prefetch={false}
            data-testid="mover-row"
          >
            <span className="rank">{index + 1}</span>
            <span>
              <span className="name">{quote.name}</span>
              <br />
              <span className="meta">
                {quote.code} · {quote.market} · 거래대금 {formatTradeValue(quote.tradeValue)}
              </span>
            </span>
            <span className="figures">
              <span className="price">{formatPrice(quote.close)}원</span>
              <br />
              <RatePill rate={quote.changeRate} />
            </span>
          </Link>
        ))
      )}
    </section>
  );
}
