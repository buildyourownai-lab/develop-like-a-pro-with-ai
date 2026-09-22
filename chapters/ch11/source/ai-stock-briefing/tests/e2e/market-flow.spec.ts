import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

function readServiceKey(): string {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const line = content
    .split("\n")
    .find((l) => l.startsWith("DATA_GO_KR_SERVICE_KEY="));
  if (!line) throw new Error("DATA_GO_KR_SERVICE_KEY를 .env.local에서 못 찾음");
  return line.slice("DATA_GO_KR_SERVICE_KEY=".length).trim();
}

const SERVICE_KEY = readServiceKey();

test.describe("시장 화면", () => {
  test("기준일·출처·순위 조건이 표시되고, 인증키는 어디에도 노출되지 않는다", async ({
    page,
  }) => {
    const leaks: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes(SERVICE_KEY)) leaks.push(req.url());
    });

    await page.goto("/");

    await expect(page.getByText(/^지수 기준일 \d{4}\.\d{2}\.\d{2}/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /상승·하락률 순위/ })).toBeVisible();
    await expect(page.getByText(/^출처: 공공데이터포털 금융위원회/)).toBeVisible();
    await expect(page.getByText(/^이 화면은 .*에 조회한 결과입니다\.$/)).toBeVisible();
    await expect(page.getByText(/^순위 집계 조건:/)).toBeVisible();

    const html = await page.content();
    expect(html.includes(SERVICE_KEY)).toBe(false);
    expect(leaks).toHaveLength(0);
  });

  test("등락률 순위의 종목을 누르면 상세·차트를 거쳐 다시 시장 화면으로 돌아온다", async ({
    page,
  }) => {
    await page.goto("/");

    const firstRankedStock = page.locator('main a[href^="/stocks/"]').first();
    const stockName = await firstRankedStock.locator("strong").first().textContent();
    await firstRankedStock.click();

    await expect(page.locator("h1")).toHaveText(stockName ?? "");
    await expect(page.getByText("기준가", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "최근 1년 주가 흐름" })).toBeVisible();
    await expect(page.locator(".recharts-wrapper").first()).toBeVisible();

    await page.getByRole("link", { name: /시장 화면으로/ }).click();
    await expect(page).toHaveURL("/");
    await expect(page.locator("h1")).toHaveText("국내 주식 한눈에");
  });

  test("검색 결과가 하나면 바로 상세 화면으로 가고, 다시 돌아올 수 있다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByPlaceholder("종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)").fill("삼성전자");
    await page.getByRole("button", { name: "찾기" }).click();

    await expect(page).toHaveURL(/\/stocks\/005930$/);
    await expect(page.locator("h1")).toHaveText("삼성전자");
    // 공시 제목에도 "최근"이 들어가므로 차트 제목을 역할과 전체 문구로 짚는다.
    await expect(
      page.getByRole("heading", { name: "최근 1년 주가 흐름" })
    ).toBeVisible();

    await page.getByRole("link", { name: /시장 화면으로/ }).click();
    await expect(page).toHaveURL("/");
  });

  test("검색 결과가 여러 개면 목록에서 골라 상세 화면으로 갈 수 있다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByPlaceholder("종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)").fill("삼성");
    await page.getByRole("button", { name: "찾기" }).click();

    await expect(page).toHaveURL(/\/search\?q=/);
    const results = page.locator('main a[href^="/stocks/"]');
    await expect(results.first()).toBeVisible();
    const count = await results.count();
    expect(count).toBeGreaterThan(1);

    await results.first().click();
    await expect(page).toHaveURL(/\/stocks\/[0-9A-Za-z]+$/);
    await expect(page.locator("h1")).toBeVisible();
  });

  test("존재하지 않는 종목을 검색하면 다시 시도할 방법을 알려준다", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByPlaceholder("종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)")
      .fill("이런종목은없다없다없다");
    await page.getByRole("button", { name: "찾기" }).click();

    await expect(page.getByText("일치하는 상장종목이 없습니다")).toBeVisible();
    await expect(page.getByText(/다시 시도해 주세요/)).toBeVisible();
  });
});
