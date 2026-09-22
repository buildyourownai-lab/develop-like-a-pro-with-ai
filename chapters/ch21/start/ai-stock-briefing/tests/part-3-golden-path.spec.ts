import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

function hasGeminiKey() {
  try {
    return /^GEMINI_API_KEY=\s*\S+/m.test(readFileSync(path.join(__dirname, "..", ".env.local"), "utf8"));
  } catch {
    return false;
  }
}

async function requestBriefingWithTransientRetry(page: import("@playwright/test").Page) {
  const panel = page.getByTestId("briefing-panel");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await panel.getByRole("button", { name: /AI 브리핑 만들기|다시 브리핑/ }).click();
    const outcome = await Promise.race([
      page.getByTestId("briefing-result").waitFor({ state: "visible", timeout: 70_000 }).then(() => "ready" as const),
      panel.getByRole("alert").waitFor({ state: "visible", timeout: 70_000 }).then(() => "error" as const),
    ]);
    if (outcome === "ready") return;
    if (attempt < 4) await page.waitForTimeout(5_000);
  }
}

test("PART 3 Golden Path: 시장에서 DART 원문과 근거 기반 AI 브리핑까지 이어 간다", async ({ page, request }) => {
  test.setTimeout(360_000);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "국내 주식 한눈에" })).toBeVisible();
  await expect(page.getByTestId("gainers").getByTestId("mover-row")).toHaveCount(5);
  await expect(page.getByTestId("losers").getByTestId("mover-row")).toHaveCount(5);

  await page.getByRole("searchbox").fill("SK하이닉스");
  await page.getByRole("button", { name: "찾기" }).click();
  await expect(page).toHaveURL(/\/stocks\/000660$/);
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");

  const chart = page.getByTestId("price-chart");
  const tradingDays = Number(/거래일 (\d+)일/.exec(await chart.locator("header .note").innerText())?.[1]);
  expect(tradingDays).toBeGreaterThan(200);
  await expect(chart.locator("g.candle")).toHaveCount(tradingDays);
  const markers = chart.locator("g.filing-marker");
  expect(await markers.count()).toBeGreaterThan(0);
  await markers.first().click({ force: true });
  await expect(chart.getByTestId("filing-picked")).toContainText(/정기공시|주요사항보고/);

  await page.getByTestId("filing-card").getByRole("link", { name: /공시 .*건 전체 보기/ }).click();
  await expect(page).toHaveURL(/\/stocks\/000660\/filings/);
  await page.getByTestId("filing-types").getByRole("link", { name: /지분공시/ }).click();
  await expect(page).toHaveURL(/type=D/);
  const documentLink = page.getByTestId("filing-row").first().locator("a");
  const documentUrl = await documentLink.getAttribute("href");
  expect(documentUrl).toMatch(/^https:\/\/dart\.fss\.or\.kr\//);
  expect((await request.get(documentUrl!)).status()).toBe(200);

  await page.goto("/stocks/000660");
  await requestBriefingWithTransientRetry(page);
  if (hasGeminiKey()) {
    const result = page.getByTestId("briefing-result");
    await expect(result).toBeVisible();
    await expect(result).toContainText("프로그램이 확인한 사실");
    await expect(result).toContainText("현재 근거만으로 알 수 없는 것");
    await expect(result.locator(".briefing-filings a").first()).toHaveAttribute("href", /^https:\/\/dart\.fss\.or\.kr\//);
  } else {
    await expect(page.getByTestId("briefing-panel").getByRole("alert")).toBeVisible({ timeout: 180_000 });
    await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  }
});
