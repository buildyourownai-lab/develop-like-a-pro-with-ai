import { expect, test } from "@playwright/test";

const BASE_DATE = /\d{4}\.\d{2}\.\d{2} \(.\)/;

test("시장 메인 화면에 기준일·지수·등락률 순위가 모두 나온다", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "국내 주식 한눈에" })).toBeVisible();

  // 데이터 기준일
  const baseDate = page.locator(".basedate").first();
  await expect(baseDate).toContainText("주식시세 기준일");
  await expect(baseDate).toContainText(BASE_DATE);

  // KOSPI·KOSDAQ 현황
  const indexCards = page.getByTestId("index-card");
  await expect(indexCards).toHaveCount(2);
  await expect(indexCards.nth(0)).toContainText("코스피");
  await expect(indexCards.nth(1)).toContainText("코스닥");
  for (const nth of [0, 1]) {
    await expect(indexCards.nth(nth).locator(".close")).toHaveText(/[\d,]+/);
    await expect(indexCards.nth(nth).locator(".change")).toHaveText(/[+-]?[\d,.]+ \([+-]?\d+\.\d\d%\)/);
  }

  // 상승률·하락률 상위 각각 5개
  await expect(page.getByTestId("gainers")).toContainText("상승률 상위");
  await expect(page.getByTestId("losers")).toContainText("하락률 상위");
  await expect(page.getByTestId("gainers").getByTestId("mover-row")).toHaveCount(5);
  await expect(page.getByTestId("losers").getByTestId("mover-row")).toHaveCount(5);
});

test("등락률 순위 목록에 종목명·현재가·등락률·거래대금이 있다", async ({ page }) => {
  await page.goto("/");

  const row = page.getByTestId("gainers").getByTestId("mover-row").first();
  await expect(row.locator(".name")).not.toBeEmpty();
  await expect(row.locator(".price")).toHaveText(/[\d,]+원/);
  await expect(row.locator(".pill")).toHaveText(/[+-]\d+\.\d\d%/);
  await expect(row.locator(".meta")).toContainText("거래대금");
});

test("상승률 상위는 상승, 하락률 상위는 하락이다", async ({ page }) => {
  await page.goto("/");

  const rate = async (testId: string) => {
    const text = await page.getByTestId(testId).getByTestId("mover-row").first().locator(".pill").innerText();
    return Number(text.replace(/[^\d.+-]/g, ""));
  };

  expect(await rate("gainers")).toBeGreaterThan(0);
  expect(await rate("losers")).toBeLessThan(0);
});

test("등락률 순위 목록을 누르면 종목 상세 화면으로 넘어간다", async ({ page }) => {
  await page.goto("/");

  const row = page.getByTestId("gainers").getByTestId("mover-row").first();
  const name = await row.locator(".name").innerText();
  await row.click();

  await expect(page).toHaveURL(/\/stocks\/\w{6}$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("종목명 일부로 검색하면 결과 목록에서 골라 상세로 간다", async ({ page }) => {
  await page.goto("/");

  // "카카오"처럼 여러 종목이 걸리는 말은 목록 화면을 지나간다.
  await page.getByRole("searchbox").fill("카카오");
  await page.getByRole("button", { name: "찾기" }).click();

  await expect(page).toHaveURL(/\/search\?q=/);
  const hits = page.getByTestId("search-hit");
  expect(await hits.count()).toBeGreaterThan(1);

  const name = await hits.first().locator(".name").innerText();
  await hits.first().click();

  await expect(page).toHaveURL(/\/stocks\/\w{6}$/);
  await expect(page.locator(".stock-head h1")).toHaveText(name);
});

test("종목명이 정확히 하나만 걸리면 곧바로 그 종목 상세로 간다", async ({ page }) => {
  await page.goto("/");

  // 상장종목정보에는 보통주만 있어서 "SK하이닉스"는 한 종목만 걸린다.
  await page.getByRole("searchbox").fill("sk하이닉스");
  await page.getByRole("button", { name: "찾기" }).click();

  await expect(page).toHaveURL(/\/stocks\/000660$/);
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
});

test("종목코드로 검색하면 그 종목 상세로 간다", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("searchbox").fill("000660");
  await page.getByRole("button", { name: "찾기" }).click();

  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  await expect(page.locator(".stock-head")).toContainText("000660");
});

test("종목 상세에 주요 가격·거래 정보와 기준일이 모두 있다", async ({ page }) => {
  await page.goto("/stocks/000660");

  const head = page.locator(".stock-head");
  await expect(head.locator("h1")).toHaveText("SK하이닉스");
  await expect(head).toContainText("KOSPI");
  await expect(head).toContainText("000660");
  await expect(head.locator(".close")).toHaveText(/[\d,]+/);
  await expect(head.locator(".change")).toHaveText(/[+-]?[\d,]+ \([+-]?\d+\.\d\d%\)/);
  await expect(head.locator(".basedate")).toContainText(BASE_DATE);

  const figures = page.getByTestId("figure-grid");
  for (const label of ["시가", "고가", "저가", "기준가", "거래량", "거래대금"]) {
    await expect(figures.getByText(label, { exact: true })).toBeVisible();
  }
});

test("최근 1년 일봉 차트가 시가·고가·저가·종가와 거래량까지 그려진다", async ({ page }) => {
  await page.goto("/stocks/000660");

  const chart = page.getByTestId("price-chart");
  await expect(chart.getByRole("heading", { name: "최근 1년 주가 흐름" })).toBeVisible();

  // 약 1년치 거래일이 들어와 있다.
  const note = await chart.locator("header .note").innerText();
  const tradingDays = Number(/거래일 (\d+)일/.exec(note)?.[1] ?? 0);
  expect(tradingDays).toBeGreaterThan(200);
  expect(tradingDays).toBeLessThan(270);

  // 가격·거래량 차트와 10장에서 추가한 공시 시점 띠가 함께 그려진다.
  expect(await chart.locator("svg.recharts-surface").count()).toBeGreaterThanOrEqual(2);
  await expect(chart.getByText("거래량", { exact: true })).toBeVisible();

  // 캔들 하나에는 몸통(rect)과 꼬리(line)가 함께 있다.
  // 차트는 브라우저에서 그려진다. 다 그려질 때까지 기다린 다음 센다.
  const candles = chart.locator("g.candle");
  await expect(candles).toHaveCount(tradingDays);
  await expect(candles.locator("rect")).toHaveCount(tradingDays);
  await expect(candles.locator("line")).toHaveCount(tradingDays);

  // 거래량 막대도 같은 거래일 수만큼 그려진다.
  await expect(chart.locator("rect.volume-bar")).toHaveCount(tradingDays);

  // 상승·하락 캔들이 색 말고 direction 값으로도 구분된다.
  expect(await chart.locator('g.candle[data-direction="up"]').count()).toBeGreaterThan(0);
  expect(await chart.locator('g.candle[data-direction="down"]').count()).toBeGreaterThan(0);

  // 종가 선 차트로 바꾸면 캔들이 선으로 바뀐다.
  await chart.getByRole("button", { name: "종가 선" }).click();
  await expect(chart.locator("path.recharts-line-curve")).toBeVisible();
  await expect(chart.locator("g.candle")).toHaveCount(0);

  // 다시 일봉으로 돌아온다.
  await chart.getByRole("button", { name: "일봉" }).click();
  await expect(chart.locator("g.candle").first()).toBeVisible();
});

test("차트 tooltip에 그날의 시가·고가·저가·종가·거래량이 나온다", async ({ page }) => {
  await page.goto("/stocks/000660");

  const priceChart = page.getByTestId("price-chart").locator("svg.recharts-surface").first();

  // 차트가 화면 아래에 있으면 마우스를 올릴 수 없다. 먼저 보이는 위치까지 굴린다.
  await priceChart.scrollIntoViewIfNeeded();
  const box = await priceChart.boundingBox();
  if (!box) {
    throw new Error("차트 영역을 찾지 못했습니다.");
  }
  await priceChart.hover({ position: { x: box.width * 0.6, y: box.height * 0.5 } });

  const tooltip = page.locator(".chart-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator(".date")).toHaveText(/\d{4}\.\d{2}\.\d{2}/);
  // 봉의 색과 같은 기준(시가 대비)을 tooltip에도 그대로 적어 둔다.
  for (const label of ["종가", "시가", "고가", "저가", "시가 대비", "거래량", "거래대금"]) {
    await expect(tooltip.getByText(label, { exact: true })).toBeVisible();
  }
});

test("종목 상세에서 시장 화면으로 돌아온다", async ({ page }) => {
  await page.goto("/stocks/000660");

  await page.getByRole("link", { name: /시장 화면으로/ }).click();

  await expect(page).toHaveURL("http://127.0.0.1:3200/");
  await expect(page.getByRole("heading", { level: 1, name: "국내 주식 한눈에" })).toBeVisible();
});

test("찾을 수 없는 종목은 빈 화면이 아니라 안내를 보여 준다", async ({ page }) => {
  await page.goto("/search?q=%EC%97%86%EB%8A%94%EC%A2%85%EB%AA%A9%EC%9D%B4%EB%A6%84");

  await expect(page.locator(".notice")).toContainText("일치하는 상장종목이 없습니다");
});

test("종목코드 형식이 틀리면 안내를 보여 준다", async ({ page }) => {
  await page.goto("/stocks/00");

  await expect(page.locator(".notice")).toContainText("종목코드 형식이 올바르지 않습니다");
});

test("모바일 화면에서도 주요 정보가 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto("/");
  await expect(page.getByTestId("index-card").first()).toBeVisible();
  await expect(page.getByTestId("gainers").getByTestId("mover-row").first()).toBeVisible();
  await expect(page.getByRole("searchbox")).toBeVisible();

  // 가로 스크롤이 생기지 않는다.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.goto("/stocks/000660");
  await expect(page.getByTestId("figure-grid")).toBeVisible();
  await expect(page.getByTestId("price-chart").locator("svg.recharts-surface").first()).toBeVisible();
});
