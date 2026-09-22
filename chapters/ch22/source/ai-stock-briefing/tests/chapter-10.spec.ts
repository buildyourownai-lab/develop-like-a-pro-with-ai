import { expect, test } from "@playwright/test";

test("10장 Golden Path: SK하이닉스 주가와 공시를 확인하고 DART 원문을 연다", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.goto("/stocks/000660");
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");

  const filingCard = page.getByTestId("filing-card");
  await expect(filingCard.getByRole("heading", { name: "이 회사 관련 공시" })).toBeVisible();
  await expect(filingCard.getByTestId("filing-total")).toContainText(/\d+건/);
  await expect(filingCard.locator(".filing-list li")).toHaveCount(5);
  await expect(filingCard.locator(".filing-date").first()).toHaveText(/\d{4}\.\d{2}\.\d{2}/);
  await expect(filingCard.locator(".filing-name").first()).not.toBeEmpty();
  await expect(filingCard.locator(".filing-filer").first()).toContainText("제출인");

  const chart = page.getByTestId("price-chart");
  const markerBand = chart.getByTestId("filing-band");
  await expect(markerBand.getByText("공시 시점", { exact: true })).toBeVisible();
  const markers = markerBand.locator("g.filing-marker");
  expect(await markers.count()).toBeGreaterThan(0);
  await markers.first().click({ force: true });
  await expect(chart.getByTestId("filing-picked")).toContainText(/정기공시|주요사항보고/);
  await expect(chart.getByTestId("filing-picked")).toContainText("제출인");

  await filingCard.getByRole("link", { name: /공시 .*건 전체 보기/ }).click();
  await expect(page).toHaveURL(/\/stocks\/000660\/filings/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("SK하이닉스 공시 전체");

  const rows = page.getByTestId("filing-row");
  await expect(rows).toHaveCount(100);
  const firstRow = rows.first();
  await expect(firstRow.locator("td").nth(0)).toHaveText(/\d{4}\.\d{2}\.\d{2}/);
  await expect(firstRow.locator("td").nth(1)).not.toBeEmpty();
  await expect(firstRow.locator("td").nth(2)).not.toBeEmpty();

  const dates = await rows.locator("td.date").allInnerTexts();
  expect(new Set(dates).size).toBeLessThan(dates.length);

  const typeLinks = page.getByTestId("filing-types");
  await expect(typeLinks.getByRole("link", { name: /정기공시/ })).toBeVisible();
  await expect(typeLinks.getByRole("link", { name: /주요사항보고/ })).toBeVisible();
  await typeLinks.getByRole("link", { name: /지분공시/ }).click();
  await expect(page).toHaveURL(/type=D/);
  await expect(page.getByTestId("filing-table-card").getByRole("heading", { level: 2 })).toContainText("지분공시");
  await expect(page.getByRole("navigation", { name: "공시 목록 페이지" })).toBeVisible();

  const documentLink = page.getByTestId("filing-row").first().locator("a");
  const href = await documentLink.getAttribute("href");
  expect(href).toMatch(/^https:\/\/dart\.fss\.or\.kr\/dsaf001\/main\.do\?rcpNo=\d{14}$/);
  const response = await request.get(href!);
  expect(response.status()).toBe(200);

  const popupPromise = page.context().waitForEvent("page");
  await documentLink.click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  expect(popup.url()).toMatch(/^https:\/\/dart\.fss\.or\.kr\/dsaf001\/main\.do\?rcpNo=\d{14}/);
  await popup.close();
});

test("10장 화면과 브라우저 자원에 API Key가 노출되지 않는다", async ({ page }) => {
  const responses: string[] = [];
  page.on("response", async (response) => {
    if (response.url().startsWith("http://127.0.0.1:3200") && response.request().resourceType() !== "image") {
      try {
        responses.push(await response.text());
      } catch {
        // streamed response
      }
    }
  });
  await page.goto("/stocks/000660/filings");
  const client = `${await page.content()}${responses.join("")}`;
  // 환경변수 이름은 서버 코드와 오류 안내에 나타날 수 있으며 Secret이 아니다.
  // 브라우저로 나가면 안 되는 것은 사용자가 입력한 실제 값이다.
  for (const secret of [process.env.OPEN_DART_API_KEY, process.env.DATA_GO_KR_SERVICE_KEY].filter(Boolean)) {
    expect(client).not.toContain(secret!);
  }
});
