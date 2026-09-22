import { readFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

const PAGES = ["/", "/search?q=SK%ED%95%98%EC%9D%B4%EB%8B%89%EC%8A%A4", "/stocks/000660"];

/**
 * "SK하이닉스"는 한 종목만 걸려서 검색 화면이 상세 화면으로 넘긴다.
 * 그 넘어가는 중에 화면을 읽으면 읽는 순간과 화면이 어긋난다. 멈출 때까지 기다린다.
 */
async function open(page: Page, target: string) {
  await page.goto(target);
  await page.waitForLoadState("networkidle");
}

/** .env.local에 있는 실제 인증키를 읽어 그 값이 브라우저로 넘어가지 않는지 검사한다. */
function readLocalSecrets(): string[] {
  try {
    const raw = readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
    return [
      "DATA_GO_KR_SERVICE_KEY",
      "OPEN_DART_API_KEY",
      "GEMINI_API_KEY",
      "SUPABASE_DATABASE_URL",
      "POSTGRES_URL",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
    ]
      .map((name) => new RegExp(`^${name}=(.+)$`, "m").exec(raw)?.[1].trim())
      .filter((value): value is string => Boolean(value));
  } catch {
    return [];
  }
}

test("인증키가 브라우저로 내려가지 않는다", async ({ page, request }) => {
  const secrets = readLocalSecrets();
  expect(secrets.length, ".env.local에 검사할 인증키가 있어야 한다").toBeGreaterThanOrEqual(2);

  const scripts = new Set<string>();
  page.on("response", (response) => {
    if (response.url().endsWith(".js")) {
      scripts.add(response.url());
    }
  });

  for (const target of PAGES) {
    await open(page, target);
    const html = await page.content();
    for (const secret of secrets) expect(html).not.toContain(secret);
    expect(html).not.toMatch(/DATA_GO_KR_SERVICE_KEY|OPEN_DART_API_KEY|GEMINI_API_KEY|SUPABASE_DATABASE_URL|POSTGRES_URL|UPSTASH_REDIS|KV_REST_API/);
    expect(html).not.toContain("apis.data.go.kr");
  }

  expect(scripts.size, "검사할 클라이언트 번들이 있어야 한다").toBeGreaterThan(0);
  for (const url of scripts) {
    const body = await (await request.get(url)).text();
    for (const secret of secrets) expect(body, `${url}에 인증키가 들어 있다`).not.toContain(secret);
    expect(body).not.toMatch(/DATA_GO_KR_SERVICE_KEY|OPEN_DART_API_KEY|GEMINI_API_KEY|SUPABASE_DATABASE_URL|POSTGRES_URL|UPSTASH_REDIS|KV_REST_API/);
  }
});

test("실시간이라고 말하지 않고 기준일과 출처를 밝힌다", async ({ page }) => {
  for (const target of PAGES) {
    await open(page, target);
    const body = await page.locator("body").innerText();

    expect(body, `${target}에 실시간 표현이 있다`).not.toMatch(/실시간 (시세|주가|데이터)(?!가 아니)/);
    expect(body).toContain("금융위원회");
    expect(body).toContain("공공데이터포털");
    expect(body).toMatch(/기준일|기준으로 조회/);
  }
});

test("PART 3 화면에 투자 판단·예측 기능을 넣지 않는다", async ({ page }) => {
  const forbidden = [
    "AI 분석",
    "추천 종목",
    "관심종목",
    "포트폴리오",
    "로그인",
    "이동평균",
    "RSI",
    "MACD",
  ];

  for (const target of PAGES) {
    await open(page, target);
    const body = await page.locator("body").innerText();
    for (const word of forbidden) {
      expect(body, `${target}에 "${word}"가 있다`).not.toContain(word);
    }
    expect(body).not.toMatch(/매수하기|매도하기|매수 의견|매도 의견|목표주가[:：]|투자 점수[:：]|상승할 가능성이 (높|낮)|하락할 가능성이 (높|낮)/);
  }
});

test("상승·하락을 색만으로 전달하지 않는다", async ({ page }) => {
  await page.goto("/");

  const pills = page.getByTestId("gainers").getByTestId("mover-row").locator(".pill");
  for (let index = 0; index < (await pills.count()); index += 1) {
    // 기호(▲/▼)와 부호(+/-)가 값에 함께 들어 있다.
    await expect(pills.nth(index)).toHaveText(/[▲▼―]\s*[+-]?\d+\.\d\d%/);
  }

  await expect(page.getByTestId("index-card").first().locator(".change")).toHaveText(/[▲▼―]/);
});

test("순위를 어떤 조건으로 뽑았는지 화면에 밝힌다", async ({ page }) => {
  await page.goto("/");

  const footnote = await page.locator(".footnote").innerText();
  expect(footnote).toContain("순위 집계 조건");
  expect(footnote).toContain("거래대금 10억원 이상");
  expect(footnote).toContain("투자 판단이나 추천을 제공하지 않습니다");
});
