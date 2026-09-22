import { expect, test } from "@playwright/test";

/**
 * 원고에 넣을 검증용 화면을 다시 만든다. 출간용 Windows 촬영과는 별개다.
 * 구현이 바뀌면 이 파일을 다시 돌려 화면과 원고를 맞춘다.
 */

const OUT = "../../assets/chapter-09";

test.use({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });

test("화면 9-1 · 9-5 · 9-6: 시장 화면", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "국내 주식 한눈에" })).toBeVisible();
  await expect(page.getByTestId("gainers")).toContainText("상승률 상위");
  await expect(page.getByTestId("losers")).toContainText("하락률 상위");
  await expect(page.getByTestId("gainers").locator(".mover-row")).toHaveCount(5);

  // 9-1 Hero: 기준일 · 검색 · 지수 · 상승률/하락률 상위 5개가 한 프레임에 들어가야 한다.
  const movers = page.locator(".movers");
  const moversBox = (await movers.boundingBox())!;
  await page.screenshot({
    path: `${OUT}/screen-09-01-hero-market.png`,
    fullPage: true,
    clip: { x: 0, y: 0, width: 1280, height: Math.ceil(moversBox.y + moversBox.height + 24) },
  });

  // 9-5: Hero 반복이 아니라 기준일 배지 · 지수 카드 · 등락률 순위 제목 영역만 확대한다.
  const rankingHead = page.getByRole("heading", { level: 2, name: /등락률 순위$/ });
  const headBox = (await rankingHead.boundingBox())!;
  await page.screenshot({
    path: `${OUT}/screen-09-05-base-date-index.png`,
    clip: { x: 0, y: 0, width: 1280, height: Math.ceil(headBox.y + headBox.height + 16) },
  });

  // 9-6: 전체/집계 종목 수와 순위 조건 · 출처 · 조회 시각이 있는 화면 아래쪽.
  const footnote = page.locator("footer").first();
  await footnote.scrollIntoViewIfNeeded();
  await expect(footnote).toContainText("투자 판단");
  await footnote.screenshot({ path: `${OUT}/screen-09-06-ranking-footnote.png` });
});

test("화면 9-8 · 9-9: SK하이닉스 종목 상세와 1년 차트", async ({ page }) => {
  await page.goto("/stocks/000660");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SK하이닉스");
  await expect(page.locator(".figure-grid")).toContainText("기준가");

  const chart = page.getByTestId("price-chart");
  await expect(chart.locator("g.candle")).toHaveCount(244);
  await expect(chart.locator("rect.volume-bar")).toHaveCount(244);

  // 9-8: 종목명·시장·코드, 기준일, 주요 수치와 차트가 한 화면에 들어간다.
  await page.screenshot({ path: `${OUT}/screen-09-08-stock-detail.png`, fullPage: true });

  // 9-9: 차트만 확대하고 tooltip까지 같은 프레임에 담는다.
  await chart.scrollIntoViewIfNeeded();
  const plot = chart.locator("svg").first();
  const plotBox = (await plot.boundingBox())!;
  await page.mouse.move(plotBox.x + plotBox.width * 0.62, plotBox.y + plotBox.height * 0.5);
  await expect(page.locator(".chart-tooltip")).toContainText("시가 대비");

  const box = (await chart.boundingBox())!;
  await page.screenshot({
    path: `${OUT}/screen-09-09-year-chart.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
});

test("화면 9-10: 1년치가 없는 종목", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("gainers").locator(".mover-row").first().click();
  await expect(page.getByTestId("price-chart")).toContainText("거래일");
  await expect(page.getByTestId("price-chart")).toContainText("1년 흐름이 아니라");
  await page.screenshot({ path: `${OUT}/screen-09-10-short-history.png`, fullPage: true });
});

test("화면 9-7: 종목명 일부로 검색한 결과", async ({ page }) => {
  await page.goto("/search?q=%EC%B9%B4%EC%B9%B4%EC%98%A4");
  await expect(page.getByTestId("search-hit").first()).toBeVisible();
  await expect(page.getByText("상장종목 기준일")).toBeVisible();
  await page.screenshot({ path: `${OUT}/screen-09-07-search-results.png`, clip: { x: 0, y: 0, width: 1280, height: 620 } });
});

test("화면 9-11: 휴대전화 화면", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
  const page = await context.newPage();

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "국내 주식 한눈에" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/screen-09-11-mobile-market.png`, fullPage: true });

  await page.goto("/stocks/000660");
  await expect(page.getByTestId("price-chart")).toBeVisible();
  await page.screenshot({ path: `${OUT}/screen-09-11-mobile-detail.png`, fullPage: true });

  await context.close();
});
