import fs from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

function readEnvLocalValue(key: string): string | undefined {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return undefined;
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split("\n").find((value) => value.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

const GEMINI_KEY = readEnvLocalValue("GEMINI_API_KEY") ?? process.env.GEMINI_API_KEY;
const HYNIX_URL = "/stocks/000660";

async function requestBriefing(page: Page) {
  await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();
  await expect(page.getByRole("button", { name: "근거를 확인하는 중…" })).toHaveCount(0, { timeout: 60_000 });
  const result = page.getByTestId("briefing-result");
  const alert = page.locator('p[role="alert"]');
  await expect(result.or(alert)).toBeVisible({ timeout: 60_000 });
  return { result, alert };
}

test.describe("AI 브리핑 화면", () => {
  test.describe.configure({ timeout: 90_000 });

  test("실행 전에는 기존 화면만 보이고 AI 결과는 자동 생성되지 않는다", async ({ page }) => {
    await page.goto(HYNIX_URL);
    await expect(page.getByRole("heading", { name: "SK하이닉스", level: 1 })).toBeVisible();
    await expect(page.getByText("이 회사 관련 공시")).toBeVisible();
    await expect(page.getByRole("button", { name: "AI 브리핑 만들기" })).toBeVisible();
    await expect(page.getByTestId("briefing-result")).toHaveCount(0);
    await expect(page.getByTestId("briefing-highlights")).toHaveCount(0);
    await expect(page.getByText("프로그램이 확인한 사실")).toHaveCount(0);
  });

  test("현행 구조화 결과 또는 현행 오류 상태를 완결된 화면으로 보여준다", async ({ page }) => {
    await page.goto(HYNIX_URL);
    const { result, alert } = await requestBriefing(page);
    if (await result.count()) {
      await expect(page.getByTestId("briefing-highlights")).toBeVisible();
      const headings = await result.locator("h3").allTextContents();
      for (const label of ["시장과 종목 비교", "최근 가격 흐름", "현재 근거만으로 알 수 없는 것"]) {
        expect(headings).toContain(label);
      }
      await expect(result.getByText("브리핑에 사용한 대표 공시")).toBeVisible();
      await expect(result.locator('a[href*="dart.fss.or.kr"]').first()).toBeVisible();
      await expect(result.getByText(/AI 설명 생성 모델:/)).toBeVisible();
      return;
    }

    await expect(alert).toContainText("AI 브리핑을 표시하지 못했습니다");
    await expect(alert).toContainText(/Gemini|브리핑/);
    // AI 단계 실패 뒤에도 프로그램 사실이 먼저 남아 있어야 한다.
    await expect(page.getByText("프로그램이 확인한 사실")).toBeVisible();
    const factTop = await page.getByText("프로그램이 확인한 사실").boundingBox();
    const alertTop = await alert.boundingBox();
    expect(factTop && alertTop && factTop.y < alertTop.y).toBeTruthy();
  });

  test("성공 결과에는 대표 공시 원문 링크와 금지 판단 경계가 있다", async ({ page }) => {
    await page.goto(HYNIX_URL);
    const { result, alert } = await requestBriefing(page);
    if (await alert.count()) {
      await expect(alert).toContainText(/Gemini 사용 한도|Gemini 인증|Gemini 설정|표시하지 않았|호출|브리핑/);
      return;
    }

    const dartLink = result.locator('a[href*="dart.fss.or.kr/dsaf001/main.do?rcpNo="]').first();
    await expect(dartLink).toBeVisible();
    expect(await dartLink.getAttribute("href")).toMatch(/^https:\/\/dart\.fss\.or\.kr\/dsaf001\/main\.do\?rcpNo=\d+$/);
    const text = await result.innerText();
    expect(text).not.toMatch(/목표주?가는?\s*[\d,]+\s*원/);
    expect(text).not.toMatch(/매수(하세요|하십시오|추천|하는\s*것이\s*좋)/);
    expect(text).not.toMatch(/매도(하세요|하십시오|추천|하는\s*것이\s*좋)/);
  });

  test("Secret이 HTML·브라우저 요청·오류 상태에 노출되지 않는다", async ({ page }) => {
    expect(GEMINI_KEY, "GEMINI_API_KEY가 .env.local에 있어야 한다").toBeTruthy();
    const leaks: string[] = [];
    page.on("request", (request) => {
      if (GEMINI_KEY && request.url().includes(GEMINI_KEY)) leaks.push(request.url());
    });
    await page.goto(HYNIX_URL);
    const { alert } = await requestBriefing(page);
    const html = await page.content();
    expect(html).not.toContain(GEMINI_KEY);
    if (await alert.count()) expect(await alert.innerText()).not.toContain(GEMINI_KEY);
    expect(leaks).toHaveLength(0);
  });
});
