import assert from "node:assert/strict";

const baseUrl = (process.env.CHAPTER14_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const forbidden = /DATA_GO_KR_SERVICE_KEY|OPEN_DART_API_KEY|GEMINI_API_KEY|SUPABASE_DATABASE_URL|UPSTASH_REDIS_REST_TOKEN/;

async function json(path: string, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(60_000) });
  assert.equal(response.status, expectedStatus, `${path} HTTP ${response.status}`);
  const body = await response.json();
  assert.equal(forbidden.test(JSON.stringify(body)), false, `${path} 응답에 Secret 이름이 포함됐다.`);
  return body as unknown;
}

async function main() {
  const market = await json("/api/mobile/market") as {
    schemaVersion: string;
    market: { priceBaseDate: string; indices: unknown[]; gainers: unknown[]; losers: unknown[] };
  };
  assert.equal(market.schemaVersion, "1.0");
  assert.match(market.market.priceBaseDate, /^\d{8}$/);
  assert.equal(market.market.indices.length, 2);
  assert.ok(market.market.gainers.length > 0);
  assert.ok(market.market.losers.length > 0);

  const search = await json("/api/mobile/stocks/search?q=000660") as {
    query: string;
    hits: { code: string }[];
  };
  assert.equal(search.query, "000660");
  assert.ok(search.hits.some((hit: { code: string }) => hit.code === "000660"));

  const stock = await json("/api/mobile/stocks/000660") as {
    quote: { code: string; baseDate: string };
    bars: unknown[];
    filings: { state: string; recent: { documentUrl: string }[] };
  };
  assert.equal(stock.quote.code, "000660");
  assert.match(stock.quote.baseDate, /^\d{8}$/);
  assert.ok(stock.bars.length >= 200);
  assert.equal(stock.filings.state, "ready");
  assert.ok(stock.filings.recent.length > 0);
  assert.ok(
    stock.filings.recent.every((filing: { documentUrl: string }) =>
      filing.documentUrl.startsWith("https://dart.fss.or.kr/")
    )
  );

  const filings = await json("/api/mobile/stocks/000660/filings") as {
    code: string;
    totalCount: number;
    filings: unknown[];
  };
  assert.equal(filings.code, "000660");
  assert.ok(filings.totalCount >= filings.filings.length);
  assert.ok(filings.filings.length > 0);

  const invalid = await json("/api/mobile/stocks/not-a-code", 400) as { code: string };
  assert.equal(invalid.code, "INVALID_STOCK_CODE");

  console.log("PASS chapter 14 mobile API contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
