/**
 * 금융위원회 API 계약 검사. 실제 공공데이터포털을 호출한다.
 *
 *   npm run test:api
 *
 * 원고가 사실로 적는 내용(정상 응답 코드 "00", endBasDt가 그 날짜를 포함하지 않음,
 * 상장종목정보의 종목코드에 A가 붙음, 기본 정렬이 기준일 내림차순)이 지금도 성립하는지 확인한다.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const BASE = "https://apis.data.go.kr/1160100/service";
const ENDPOINT = {
  stockPrice: `${BASE}/GetStockSecuritiesInfoService/getStockPriceInfo`,
  marketIndex: `${BASE}/GetMarketIndexInfoService/getStockMarketIndex`,
  listedInfo: `${BASE}/GetKrxListedInfoService/getItemInfo`,
};

function serviceKey(): string {
  const fromEnv = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const raw = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
  const found = /^DATA_GO_KR_SERVICE_KEY=(.+)$/m.exec(raw)?.[1].trim();
  assert.ok(found, ".env.local에 DATA_GO_KR_SERVICE_KEY가 없습니다.");
  return found;
}

const KEY = serviceKey();

type Row = Record<string, string>;

async function call(endpoint: string, params: Record<string, string | number>) {
  const query = new URLSearchParams({ resultType: "json" });
  for (const [k, v] of Object.entries(params)) {
    query.set(k, String(v));
  }
  const key = KEY.includes("%") ? KEY : encodeURIComponent(KEY);
  const response = await fetch(`${endpoint}?serviceKey=${key}&${query}`, {
    signal: AbortSignal.timeout(45_000),
  });
  assert.equal(response.status, 200, `HTTP ${response.status}`);

  const payload = JSON.parse(await response.text());
  const header = payload.response?.header;
  assert.equal(String(header?.resultCode), "00", `정상 응답 코드는 "00"이다. 받은 값: ${header?.resultCode}`);

  const items = payload.response?.body?.items?.item;
  return {
    totalCount: Number(payload.response?.body?.totalCount ?? 0),
    rows: (Array.isArray(items) ? items : items ? [items] : []) as Row[],
  };
}

function hasFields(row: Row, fields: string[], label: string) {
  for (const field of fields) {
    assert.ok(field in row, `${label} 응답에 ${field}가 없다`);
  }
}

function shiftDays(compact: string, days: number): string {
  const date = new Date(
    Date.UTC(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)))
  );
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

const checks: string[] = [];
const pass = (line: string) => {
  checks.push(line);
  console.log(`  PASS  ${line}`);
};

async function main() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" })
    .format(new Date())
    .replaceAll("-", "");

  // 1. 기본 정렬이 기준일 내림차순이다. 이 성질로 최근 제공 거래일을 한 번에 찾는다.
  const recent = await call(ENDPOINT.stockPrice, {
    beginBasDt: shiftDays(today, -20),
    numOfRows: 30,
    pageNo: 1,
  });
  assert.ok(recent.rows.length > 0, "최근 20일 안에 제공된 주식시세가 있어야 한다");
  const dates = recent.rows.map((row) => row.basDt);
  assert.deepEqual(dates, [...dates].sort().reverse(), "기본 정렬은 기준일 내림차순이다");
  const baseDate = dates[0];
  pass(`주식시세 기본 정렬 = 기준일 내림차순, 최근 제공 거래일 ${baseDate}`);

  // 2. 주식시세 필드가 그대로 있다. 시가·고가·저가·종가·거래량·거래대금이 모두 온다.
  hasFields(
    recent.rows[0],
    ["basDt", "srtnCd", "isinCd", "itmsNm", "mrktCtg", "clpr", "vs", "fltRt", "mkp", "hipr", "lopr", "trqu", "trPrc"],
    "주식시세정보"
  );
  pass("주식시세정보 필드 유지 (mkp·hipr·lopr·clpr·trqu·trPrc 포함)");

  // 3. 하루치 전 종목을 한 번에 받을 수 있다.
  const oneDay = await call(ENDPOINT.stockPrice, { basDt: baseDate, numOfRows: 4000, pageNo: 1 });
  assert.equal(oneDay.rows.length, oneDay.totalCount, "한 번에 하루치 전 종목을 받을 수 있다");
  assert.ok(oneDay.totalCount > 2000, `하루치 종목 수가 너무 적다: ${oneDay.totalCount}`);
  const markets = new Set(oneDay.rows.map((row) => row.mrktCtg));
  assert.ok(markets.has("KOSPI") && markets.has("KOSDAQ"), "KOSPI·KOSDAQ가 함께 온다");
  pass(`${baseDate} 하루치 ${oneDay.totalCount}종목 일괄 수신, 시장 구분 ${[...markets].join("·")}`);

  // 4. 오늘 날짜로 바로 조회하면 아직 없을 수 있다. 그래서 기준일을 따로 찾아야 한다.
  const todayOnly = await call(ENDPOINT.stockPrice, { basDt: today, numOfRows: 1, pageNo: 1 });
  pass(`오늘(${today}) 직접 조회 결과 ${todayOnly.totalCount}건 -> 기준일 탐색이 필요하다`);

  // 5. endBasDt는 그 날짜를 포함하지 않는다. 1년 차트가 기준일까지 나오려면 +1일을 넣어야 한다.
  const inclusive = await call(ENDPOINT.stockPrice, {
    likeSrtnCd: "000660",
    beginBasDt: shiftDays(baseDate, -10),
    endBasDt: baseDate,
    numOfRows: 30,
    pageNo: 1,
  });
  const exclusive = await call(ENDPOINT.stockPrice, {
    likeSrtnCd: "000660",
    beginBasDt: shiftDays(baseDate, -10),
    endBasDt: shiftDays(baseDate, 1),
    numOfRows: 30,
    pageNo: 1,
  });
  assert.ok(
    !inclusive.rows.some((row) => row.basDt === baseDate),
    `endBasDt=${baseDate}에는 ${baseDate}가 포함되지 않아야 한다`
  );
  assert.ok(
    exclusive.rows.some((row) => row.basDt === baseDate),
    `endBasDt=${shiftDays(baseDate, 1)}에는 ${baseDate}가 포함돼야 한다`
  );
  pass("endBasDt는 그 날짜를 포함하지 않는다 (기준일까지 받으려면 +1일)");

  // 6. 1년 구간이 240일 안팎으로 들어온다.
  const year = await call(ENDPOINT.stockPrice, {
    likeSrtnCd: "000660",
    beginBasDt: shiftDays(baseDate, -365),
    endBasDt: shiftDays(baseDate, 1),
    numOfRows: 400,
    pageNo: 1,
  });
  const own = year.rows.filter((row) => row.srtnCd === "000660");
  assert.ok(own.length > 200 && own.length < 270, `1년 거래일 수가 이상하다: ${own.length}`);
  pass(`000660 최근 1년 일별 시세 ${own.length}건`);

  // 7. 지수시세정보의 idxNm은 정확히 일치한다.
  for (const idxNm of ["코스피", "코스닥"]) {
    const index = await call(ENDPOINT.marketIndex, {
      idxNm,
      beginBasDt: shiftDays(today, -20),
      numOfRows: 1,
      pageNo: 1,
    });
    assert.equal(index.rows.length, 1, `${idxNm} 지수를 받아야 한다`);
    assert.equal(index.rows[0].idxNm, idxNm, `idxNm은 정확히 일치한다`);
    hasFields(index.rows[0], ["basDt", "idxNm", "clpr", "vs", "fltRt", "mkp", "hipr", "lopr", "trPrc"], "지수시세정보");
    pass(`지수시세정보 ${idxNm} 기준일 ${index.rows[0].basDt} 종가 ${index.rows[0].clpr}`);
  }

  // 8. 상장종목정보의 종목코드에는 A가 붙는다. 주식시세정보와 표기가 다르다.
  const listed = await call(ENDPOINT.listedInfo, { likeItmsNm: "SK하이닉스", numOfRows: 5, pageNo: 1 });
  assert.ok(listed.rows.length > 0, "상장종목정보를 받아야 한다");
  hasFields(listed.rows[0], ["basDt", "srtnCd", "isinCd", "mrktCtg", "itmsNm", "corpNm"], "KRX상장종목정보");
  assert.ok(
    listed.rows.some((row) => /^A\d{5}[\dA-Z]$/.test(row.srtnCd)),
    "상장종목정보 종목코드에는 A가 붙는다"
  );
  pass("KRX상장종목정보 종목코드에 A 접두어가 붙는다 (주식시세정보와 표기 다름)");

  // 9. 그날 거래가 없던 종목은 거래량이 0으로 온다. 가격까지 0이 되는 것은 아니다.
  //    원고가 "거래량이 0" 때문에 순위에서 빼는 것으로 적으므로, 그 근거를 여기서 확인한다.
  const noTrade = oneDay.rows.filter((row) => Number(row.trqu) === 0);
  assert.ok(noTrade.length > 0, "거래가 없던 종목이 하루치 안에 섞여 있다");
  const priceAlsoZero = noTrade.filter((row) => Number(row.clpr) === 0);
  assert.equal(priceAlsoZero.length, 0, "거래량이 0이어도 종가까지 0으로 오지는 않는다");
  pass(
    `${baseDate} 거래량 0 종목 ${noTrade.length}건 (그중 종가까지 0인 종목 ${priceAlsoZero.length}건) — 기준일에 따라 달라진다`
  );

  console.log(`\n금융위원회 API 계약 검사 PASS: ${checks.length}항목 / 기준일 ${baseDate}`);
}

main().catch((error) => {
  console.error("\n금융위원회 API 계약 검사 FAIL");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
