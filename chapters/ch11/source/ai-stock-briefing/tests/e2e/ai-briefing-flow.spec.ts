import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

// Playwright 테스트 파일은 Next.js 서버와 별개의 Node 프로세스에서 돌아가
// process.env가 .env.local을 자동으로 읽지 않는다 — market-flow.spec.ts와
// 같은 방식으로 파일에서 직접 읽는다.
function readEnvLocalValue(key: string): string | undefined {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  const line = content.split("\n").find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

const GEMINI_KEY = readEnvLocalValue("GEMINI_API_KEY");

// AI 브리핑은 버튼을 눌러야 실행되고, 실제 Gemini를 부른다. Gemini 응답은
// 자유 문장이라 매번 같은 텍스트인지는 보지 않는다 — 여기서는 화면
// 구조(순서·DART 링크·복원력)만 확인한다. 이 구조는 Gemini 성공/실패와
// 무관하게 항상 같아야 한다.
const HYNIX_URL = "/stocks/000660";

test.describe("AI 브리핑 화면", () => {
  // Gemini를 두 번(생성+검증) 실제로 부르는 테스트가 있어, 기본 테스트
  // 시간(30초)보다 넉넉하게 둔다.
  test.describe.configure({ timeout: 90_000 });

  test("버튼을 누르기 전에는 실행되지 않고, 기존 화면(차트·공시·상세시세)은 그대로 보인다", async ({
    page,
  }) => {
    await page.goto(HYNIX_URL);

    await expect(page.getByText("상세 시세")).toBeVisible();
    await expect(page.getByText(/최근 (1년|\d+거래일) 일별 시세/)).toBeVisible();
    await expect(page.getByText("최근 1년 공시")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "AI 브리핑 만들기" })
    ).toBeVisible();

    // 버튼을 누르기 전에는 "핵심 브리핑"이나 "프로그램이 확인한 사실"이
    // 아직 화면에 없어야 한다 — 자동으로 실행되지 않는다는 뜻이다.
    await expect(page.getByText("핵심 브리핑")).toHaveCount(0);
    await expect(page.getByText("프로그램이 확인한 사실")).toHaveCount(0);
  });

  test("핵심 브리핑 → 시장·가격 근거 → 최근 1년간 회사 공시 → 알 수 없는 것 순서로 나온다", async ({
    page,
  }) => {
    await page.goto(HYNIX_URL);
    await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();

    await expect(
      page.getByRole("button", { name: "브리핑 만드는 중..." })
    ).toHaveCount(0, { timeout: 60_000 });

    // Gemini 설명이 검증에 걸려 표시되지 않을 수도 있다 — 그래도 아래
    // 구조(사실 영역들의 순서)는 항상 같아야 하므로, 성공/실패 어느
    // 쪽이든 진행한다.
    const headingTexts = await page
      .locator("h3, h4")
      .allTextContents();
    const order = [
      "핵심 브리핑",
      "시장과 종목 비교",
      "최근 가격 흐름",
      "최근 1년간 회사 공시",
      "현재 근거만으로 알 수 없는 것",
    ];
    const indices = order.map((label) => headingTexts.indexOf(label));

    expect(indices.every((i) => i !== -1)).toBe(true);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  test("공시 목록에 DART 원문으로 가는 링크가 있고, 실제로 그 회사 문서가 열린다", async ({
    page,
  }) => {
    await page.goto(HYNIX_URL);
    await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();
    await expect(
      page.getByRole("button", { name: "브리핑 만드는 중..." })
    ).toHaveCount(0, { timeout: 60_000 });

    const briefingSection = page.locator("section", {
      has: page.getByRole("heading", { name: "AI 브리핑" }),
    });
    const dartLinks = briefingSection.locator('a[href*="dart.fss.or.kr"]');
    await expect(dartLinks.first()).toBeVisible();

    const href = await dartLinks.first().getAttribute("href");
    expect(href).toMatch(/^https:\/\/dart\.fss\.or\.kr\/dsaf001\/main\.do\?rcpNo=\d+$/);

    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toContain("SK하이닉스");
  });

  test("AI 설명이 나오면 실제 목표주가 제시나 매수·매도 권유가 없다", async ({
    page,
  }) => {
    await page.goto(HYNIX_URL);
    await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();
    await expect(
      page.getByRole("button", { name: "브리핑 만드는 중..." })
    ).toHaveCount(0, { timeout: 60_000 });

    const summaryParagraph = page.locator('h3:has-text("핵심 브리핑") + p');
    const hasSummary = await summaryParagraph.count();
    if (hasSummary === 0) {
      // 이번 호출은 검증 단계에서 걸러졌거나 실패했다는 뜻 — 그 경우엔
      // 아래 오류 안내가 대신 보여야 한다(화면이 비어 있으면 안 된다).
      await expect(page.getByText("AI 설명을 만들지 못했습니다")).toBeVisible();
      return;
    }

    // "목표주가"·"매수"·"매도" 낱말 자체는 "~는 제공되지 않는다" 같은
    // 안내 문장에도 정상적으로 나온다(실제로 확인함) — 그래서 낱말이
    // 있는지가 아니라, 실제로 값을 제시하거나 행동을 권하는 패턴인지를
    // 본다. 의미 판단 자체는 verifyStockBriefing이 이미 맡고 있고, 여기서는
    // 그 판단을 통과한 문장에 뻔한 위반이 남아있지 않은지만 다시 확인한다.
    const summaryText = await summaryParagraph.innerText();
    expect(summaryText).not.toMatch(/목표주?가는?\s*[\d,]+\s*원/);
    expect(summaryText).not.toMatch(/매수(하세요|하십시오|추천|하는\s*것이\s*좋)/);
    expect(summaryText).not.toMatch(/매도(하세요|하십시오|추천|하는\s*것이\s*좋)/);
  });

  test("Secret이 화면·요청 어디에도 노출되지 않는다", async ({ page }) => {
    expect(GEMINI_KEY, "GEMINI_API_KEY가 .env.local에 있어야 한다").toBeTruthy();

    const leaks: string[] = [];
    page.on("request", (req) => {
      if (GEMINI_KEY && req.url().includes(GEMINI_KEY)) leaks.push(req.url());
    });

    await page.goto(HYNIX_URL);
    await page.getByRole("button", { name: "AI 브리핑 만들기" }).click();
    await expect(
      page.getByRole("button", { name: "브리핑 만드는 중..." })
    ).toHaveCount(0, { timeout: 60_000 });

    const html = await page.content();
    expect(GEMINI_KEY && html.includes(GEMINI_KEY)).toBe(false);
    expect(leaks).toHaveLength(0);
  });
});
