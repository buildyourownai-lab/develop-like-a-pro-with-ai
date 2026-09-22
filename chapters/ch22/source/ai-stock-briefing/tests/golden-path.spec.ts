import { expect, test } from "@playwright/test";

/**
 * 9장 Golden Path.
 * 독자가 실제로 지나가는 한 줄기 경로를 끊지 않고 한 번에 걸어 본다.
 * 시장을 본다 -> 등락률 순위에서 크게 움직인 종목을 찾는다 -> 그 종목을 열어 본다 -> 1년 흐름을 본다
 * -> 궁금한 종목을 검색한다 -> 다시 시장으로 돌아온다
 */
test("9장 Golden Path: 시장 확인 -> 등락률 순위 -> 종목 상세 -> 1년 차트 -> 종목 검색 -> 시장 복귀", async ({
  page,
}) => {
  const steps: string[] = [];
  const record = (line: string) => {
    steps.push(line);
    console.log(`  [golden-path] ${line}`);
  };

  // 1. 시장 화면에서 기준일과 지수를 확인한다.
  await page.goto("/");
  const priceBaseDate = await page.locator(".basedate").first().innerText();
  expect(priceBaseDate).toMatch(/\d{4}\.\d{2}\.\d{2}/);
  record(`시장 화면 기준일: ${priceBaseDate.replace(/\s+/g, " ")}`);

  const indexCards = page.getByTestId("index-card");
  await expect(indexCards).toHaveCount(2);
  for (const nth of [0, 1]) {
    const text = (await indexCards.nth(nth).innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(/[▲▼―]/);
    record(`지수: ${text.slice(0, 60)}`);
  }

  // 2. 상승률 상위에서 1위를 찾는다.
  await expect(page.getByTestId("gainers")).toContainText("상승률 상위");
  await expect(page.getByTestId("losers")).toContainText("하락률 상위");
  const topRow = page.getByTestId("gainers").getByTestId("mover-row").first();
  const topName = await topRow.locator(".name").innerText();
  const topRate = await topRow.locator(".pill").innerText();
  expect(Number(topRate.replace(/[^\d.+-]/g, ""))).toBeGreaterThan(0);
  record(`상승률 상위 1위: ${topName} ${topRate.replace(/\s+/g, " ")}`);

  // 3. 눌러서 그 종목 상세로 넘어간다.
  await topRow.click();
  await expect(page).toHaveURL(/\/stocks\/\w{6}$/);
  await expect(page.locator(".stock-head h1")).toHaveText(topName);
  const detailCode = new URL(page.url()).pathname.split("/").pop() ?? "";
  record(`종목 상세 도착: ${topName} (${detailCode})`);

  // 4. 주요 가격·거래 정보를 확인한다.
  const figures = page.getByTestId("figure-grid");
  for (const label of ["시가", "고가", "저가", "기준가", "거래량", "거래대금"]) {
    await expect(figures.getByText(label, { exact: true })).toBeVisible();
  }
  record("주요 가격·거래 정보 6개 항목 확인");

  // 5. 일봉 차트를 확인한다.
  // 급등 1위는 최근 상장 종목일 수 있어서 거래일이 1년치가 아닐 수 있다.
  // 1년을 억지로 기대하지 않고, 화면이 실제 거래일 수와 어긋나지 않는지만 본다.
  const chart = page.getByTestId("price-chart");
  const note = await chart.locator("header .note").innerText();
  const tradingDays = Number(/거래일 (\d+)일/.exec(note)?.[1] ?? 0);
  expect(tradingDays).toBeGreaterThan(0);
  expect(await chart.locator("svg.recharts-surface").count()).toBeGreaterThanOrEqual(2);
  // 차트는 브라우저에서 그려진다. 다 그려질 때까지 기다린 다음 센다.
  await expect(chart.locator("g.candle")).toHaveCount(tradingDays);
  await expect(chart.locator("rect.volume-bar")).toHaveCount(tradingDays);
  const candleCount = tradingDays;
  const volumeCount = tradingDays;
  if (tradingDays < 200) {
    // 짧으면 짧다고 말해야 한다. 1년인 척하지 않는다.
    await expect(chart.locator(".chart-note:not(.filing-marker-note)")).toContainText(`거래일이 ${tradingDays}일`);
    record(`차트 구간이 짧은 종목: ${note.replace(/\s+/g, " ")} + 짧다는 안내 확인`);
  }
  record(`일봉 차트: ${note.replace(/\s+/g, " ")} (캔들 ${candleCount}개, 거래량 막대 ${volumeCount}개)`);

  // 5-1. 1년치가 충분한 대표 종목(SK하이닉스)으로 1년 차트를 확인한다.
  await page.goto("/stocks/000660");
  const yearChart = page.getByTestId("price-chart");
  const yearNote = await yearChart.locator("header .note").innerText();
  const yearDays = Number(/거래일 (\d+)일/.exec(yearNote)?.[1] ?? 0);
  expect(yearDays).toBeGreaterThan(200);
  expect(yearDays).toBeLessThan(270);
  await expect(yearChart.locator("g.candle")).toHaveCount(yearDays);
  await expect(yearChart.locator("rect.volume-bar")).toHaveCount(yearDays);
  await expect(yearChart.locator(".chart-note:not(.filing-marker-note)")).toHaveCount(0);
  record(`1년 차트(SK하이닉스): ${yearNote.replace(/\s+/g, " ")} · 캔들·거래량 ${yearDays}개`);

  // 6. 궁금한 종목을 이름으로 검색한다.
  // 상장종목정보에는 보통주만 있어서 "SK하이닉스"는 한 종목만 걸리고 곧바로 상세로 넘어간다.
  await page.getByRole("searchbox").fill("SK하이닉스");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/\/stocks\/000660$/);
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  record(`종목명 검색 -> 상세 도착: ${await page.locator(".stock-head h1").innerText()}`);

  // 7. 종목코드로도 검색한다.
  await page.getByRole("searchbox").fill("000660");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  const hynixBaseDate = await page.locator(".stock-head .basedate").innerText();
  record(`종목코드 검색 -> 상세 도착: SK하이닉스 / ${hynixBaseDate.replace(/\s+/g, " ")}`);

  // 8. 시장 화면으로 돌아온다.
  await page.getByRole("link", { name: /시장 화면으로/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "국내 주식 한눈에" })).toBeVisible();
  record("시장 화면 복귀");

  expect(steps.length).toBeGreaterThanOrEqual(9);
});
