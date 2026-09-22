import Link from "next/link";
import { redirect } from "next/navigation";

import { searchStocks } from "@/lib/stock";
import { formatBaseDate } from "@/lib/trading-date";
import { BaseDateBadge, SearchBar, SourceFootnote } from "@/components/ui";

export const revalidate = 600;

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = (await searchParams).q?.trim() ?? "";

  if (query.length === 0) {
    return (
      <>
        <BackToMarket />
        <SearchBar />
        <p className="card notice">
          <strong>찾고 싶은 종목을 입력해 주세요</strong>
          종목명 또는 종목코드로 찾을 수 있습니다. (예: SK하이닉스, 000660)
        </p>
      </>
    );
  }

  const { baseDate, hits } = await searchStocks(query);

  if (hits.length === 1) {
    redirect(`/stocks/${hits[0].code}`);
  }

  return (
    <>
      <BackToMarket />
      <SearchBar defaultValue={query} />

      <div className="section-head">
        <h2>
          “{query}” 검색 결과 {hits.length}건
        </h2>
        {baseDate && <BaseDateBadge label="상장종목 기준일" baseDate={baseDate} />}
      </div>

      {hits.length === 0 ? (
        <p className="card notice">
          <strong>일치하는 상장종목이 없습니다</strong>
          {formatBaseDate(baseDate)} 기준 KRX 상장종목정보에서 “{query}”를 찾지 못했습니다. 종목명 전체나 여섯
          자리 종목코드로 다시 시도해 주세요.
        </p>
      ) : (
        <div className="card">
          {hits.map((hit) => (
            <Link
              key={hit.code}
              className="hit-row"
              data-testid="search-hit"
              href={`/stocks/${hit.code}`}
              prefetch={false}
            >
              <span>
                <span className="name">{hit.name}</span>
                <br />
                <span className="corp">{hit.corpName}</span>
              </span>
              <span>
                <span className="tag">{hit.market}</span> <span className="tag">{hit.code}</span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <SourceFootnote />
    </>
  );
}

function BackToMarket() {
  return (
    <Link className="back-link" href="/">
      <span aria-hidden="true">←</span> 시장 화면으로
    </Link>
  );
}
