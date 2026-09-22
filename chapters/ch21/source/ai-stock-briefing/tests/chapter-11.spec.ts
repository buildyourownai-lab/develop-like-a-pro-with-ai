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

test("AI가 없어도 기존 SK하이닉스 가격·차트·공시 화면은 먼저 표시된다", async ({ page }) => {
  await page.goto("/stocks/000660");
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  await expect(page.getByTestId("price-chart")).toBeVisible();
  await expect(page.getByTestId("filing-card")).toBeVisible();
  await expect(page.getByTestId("briefing-panel")).toContainText("AI 브리핑 만들기");
  await expect(page.getByTestId("briefing-result")).toHaveCount(0);
});

test("Gemini 키가 없으면 브리핑만 실패하고 기존 근거 화면은 유지된다", async ({ page }) => {
  test.skip(hasGeminiKey(), "실제 키가 있는 환경에서는 성공 Golden Path가 대신 검증한다.");
  await page.goto("/stocks/000660");
  await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();
  await expect(page.getByTestId("briefing-panel").getByRole("alert")).toContainText(
    "AI 브리핑을 표시하지 못했습니다",
    { timeout: 180_000 }
  );
  await expect(page.locator(".stock-head h1")).toHaveText("SK하이닉스");
  await expect(page.getByTestId("filing-card")).toBeVisible();
});

test("실제 Gemini가 확인된 근거와 AI 설명을 분리한 SK하이닉스 브리핑을 만든다", async ({ page }) => {
  test.skip(!hasGeminiKey(), ".env.local에 사람이 직접 넣은 GEMINI_API_KEY가 필요하다.");
  test.setTimeout(300_000);
  await page.goto("/stocks/000660");
  const displayedClose = await page.locator(".stock-head .quote .close").innerText();
  const displayedFilingCount = /([\d,]+)건/.exec(await page.getByTestId("filing-total").innerText())?.[1];

  await requestBriefingWithTransientRetry(page);
  const result = page.getByTestId("briefing-result");
  await expect(result).toBeVisible();
  await expect(result.locator(".verified-facts")).toContainText("프로그램이 확인한 사실");
  await expect(result.locator(".ai-explanation")).toContainText("AI가 근거를 읽고 정리한 설명");
  await expect(result.getByTestId("briefing-highlights")).toContainText("핵심 브리핑");
  await expect(result).toContainText("시장과 종목 비교");
  await expect(result).toContainText("최근 1년간 회사 공시");
  await expect(result).toContainText(displayedClose);
  await expect(result).toContainText(`${displayedFilingCount}건`);
  await expect(result).toContainText("현재 근거만으로 알 수 없는 것");
  await expect(result.locator(".briefing-filings a").first()).toHaveAttribute("href", /^https:\/\/dart\.fss\.or\.kr\//);
  await expect(result.locator(".model-note")).toContainText("gemini-3.5-flash-lite");

  const aiText = await result.locator(".ai-explanation").innerText();
  expect(aiText).toMatch(/[0-9]/);
  expect(aiText).not.toContain("SK하이닉스은");
  expect(aiText).not.toMatch(/정보를 확인했|자료가 포함되어|기록을 계산하였|다양한 공시가 접수/);
  expect(aiText).not.toMatch(/매수하기|매도하기|매수 의견|매도 의견|목표\s*주가[:：]|투자\s*추천|때문에|원인으로|영향으로|상승할|하락할/);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(result.getByTestId("briefing-highlights")).toBeVisible();
  const mobileOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(mobileOverflow).toBeLessThanOrEqual(1);
});

test("모바일에서도 브리핑 진입점과 기존 근거가 가로 넘침 없이 보인다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/stocks/000660");
  await expect(page.getByTestId("briefing-panel")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 브리핑 만들기" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
