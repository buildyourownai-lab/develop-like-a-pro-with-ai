/**
 * 22장 대화 화면 확인(21장은 기획, 구현은 22장이다).
 *
 * **실제 AI API를 부르지 않는다.** 아래 화면 시험은 모두 `page.route`로 `/api/chat` 응답을
 * 명시적으로 대신 만들어(mock) 브라우저 상태만 확인한다. 모델 답변 품질이나 실제 조회 결과의
 * 증거가 아니다. 서버가 만드는 근거·문구는 단위 시험에서 확인한다.
 *
 * 기본 활성 상태와 명시적으로 끈 상태(버튼 없음·API 404)를 각각 확인한다.
 */
import { expect, test, type Page } from "@playwright/test";

import type { ChatAnswerPayload, ChatTarget } from "../src/lib/chat-contract";
import { chatEnabledFrom } from "../src/lib/chat-contract";

const chatEnabled = chatEnabledFrom({ CHAT_ENABLED: process.env.CHAT_ENABLED });

const SAMSUNG: ChatTarget = {
  code: "005930",
  name: "삼성전자",
  market: "KOSPI",
  corpName: "삼성전자",
  baseDate: "20260911",
};
const HYNIX: ChatTarget = {
  code: "000660",
  name: "SK하이닉스",
  market: "KOSPI",
  corpName: "SK하이닉스",
  baseDate: "20260911",
};
const SAMSUNG_PREFERRED: ChatTarget = {
  code: "005935",
  name: "삼성전자우",
  market: "KOSPI",
  corpName: "삼성전자",
  baseDate: "20260911",
};

/** 시험용 답변 한 건. 서버가 실제로 만드는 모양을 그대로 흉내 내지만 값은 시험용 고정값이다. */
function answer(id: string, patch: Partial<ChatAnswerPayload> = {}): ChatAnswerPayload {
  return {
    requestId: id,
    verified: null,
    general: null,
    status: null,
    selection: null,
    target: null,
    steps: [],
    model: "mock-not-real-api",
    generatedAt: "2026-09-14T09:00:00.000Z",
    ...patch,
  };
}

function verified(patch: Partial<NonNullable<ChatAnswerPayload["verified"]>>) {
  return {
    heading: "확인된 자료" as const,
    target: null,
    price: null,
    filings: null,
    notes: [],
    preparedAt: "2026-09-14T09:00:00.000Z",
    ...patch,
  };
}

function filingsOf(target: ChatTarget) {
  return {
    from: "20260601",
    to: "20260914",
    requestedCount: 1,
    shownCount: 1,
    totalCount: 3,
    items: [
      {
        receiptNo: `2026091400000${target.code.slice(-1)}`,
        receiptDate: "20260912",
        reportName: `${target.name} 주요사항보고서`,
        filerName: target.corpName,
        documentUrl: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=2026091400000${target.code.slice(-1)}`,
      },
    ],
  };
}

type MockReply = { status?: number; json: unknown };

/**
 * `/api/chat`을 순서대로 정해 둔 응답으로 대신한다. 실제 API·모델은 부르지 않는다.
 * @returns 브라우저가 실제로 보낸 요청 본문 목록. 화면이 무엇을 보냈는지 확인할 때 쓴다.
 */
async function mockChat(page: Page, replies: Array<MockReply | ((body: Record<string, unknown>) => MockReply)>) {
  const sent: Array<Record<string, unknown>> = [];
  await page.route("**/api/chat", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    const reply = replies[Math.min(sent.length, replies.length - 1)];
    sent.push(body);
    const resolved = typeof reply === "function" ? reply(body) : reply;
    await route.fulfill({
      status: resolved.status ?? 200,
      contentType: "application/json",
      body: JSON.stringify(resolved.json),
    });
  });
  return sent;
}

async function openChat(page: Page, path = "/") {
  await page.goto(path);
  await page.getByRole("button", { name: "AI에게 질문" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function ask(page: Page, question: string) {
  await page.getByRole("textbox", { name: "질문" }).fill(question);
  await page.getByRole("button", { name: "질문 보내기" }).click();
}

test.describe("대화 기능을 켠 로컬 확인", () => {
  test.skip(!chatEnabled, "CHAT_ENABLED=true로 실행할 때만 확인한다.");

  test("기간을 묻지 않은 질문에는 최근 확인 종가와 기준일만 보여 준다", async ({ page }) => {
    await mockChat(page, [
      {
        json: answer("a-latest", {
          target: SAMSUNG,
          steps: ["종목 확인", "최근 종가 확인"],
          verified: verified({
            target: SAMSUNG,
            price: {
              kind: "latest",
              baseDate: "20260911",
              quoteDate: "20260911",
              close: 71_200,
              endsBeforeBaseDate: false,
            },
          }),
          general: {
            heading: "AI 일반 설명",
            disclaimer: "최신 확인 자료가 아닙니다",
            summary: "종가는 그 거래일의 마지막 체결 가격입니다.",
            points: ["기준일은 확인된 마지막 거래일을 뜻합니다."],
          },
        }),
      },
    ]);
    await openChat(page);
    await ask(page, "삼성전자 최근 확인 종가와 기준일은? 기준일이 왜 중요해?");

    const price = page.locator(".chat-price");
    await expect(price).toContainText("최근 확인 종가 · 가격 기준일 2026.09.11");
    await expect(price).toContainText("종가 71,200원");
    await expect(price).toContainText("기준일은 이 서비스가 확인한 마지막 가격 날짜입니다");
    // 요청하지 않은 기간 요약을 만들지 않는다. 되묻지도 않는다.
    await expect(price).not.toContainText("가격 요약");
    await expect(price).not.toContainText("구간 변화");
    await expect(page.locator(".chat-log")).not.toContainText("1개월");
    // S3에서 넣은 준비 시각·수행 내역 표시가 그대로 남아 있는지 함께 본다.
    await expect(page.locator(".chat-prepared")).toContainText("준비 시각");
    await expect(page.locator(".chat-steps")).toContainText("종목 확인 → 최근 종가 확인");
    await expect(page.locator(".chat-general")).toContainText("최신 확인 자료가 아닙니다");
  });

  test("흐름을 물으면 기간을 되묻고, 기간 요약 답변은 요청 구간과 확인된 구간을 함께 보여 준다", async ({ page }) => {
    await mockChat(page, [
      {
        json: answer("a-ask-period", {
          target: SAMSUNG,
          status: {
            message: "가격 흐름은 달력 1개월·3개월·12개월 중 어느 기간으로 볼지 알려 주세요.",
            nextActions: ["기간 고르기"],
          },
        }),
      },
      {
        json: answer("a-range", {
          target: SAMSUNG,
          steps: ["종목 확인", "3개월 가격 요약"],
          verified: verified({
            target: SAMSUNG,
            price: {
              kind: "range",
              periodLabel: "3개월",
              baseDate: "20260911",
              requestedFrom: "20260611",
              requestedTo: "20260911",
              actualFrom: "20260612",
              actualTo: "20260911",
              tradingDays: 62,
              startClose: 65_000,
              endClose: 71_200,
              highestHigh: 72_500,
              lowestLow: 63_100,
              closeChange: 6_200,
              closeChangeRate: 9.54,
              baseDateClose: 71_200,
              limitedBySource: false,
              endsBeforeRequestedTo: false,
              sourceFrom: "20260612",
              sourceTo: "20260911",
            },
          }),
        }),
      },
    ]);
    await openChat(page);
    await ask(page, "삼성전자 가격 흐름 알려줘");
    await expect(page.locator(".chat-scope")).toContainText("달력 1개월·3개월·12개월");
    await expect(page.locator(".chat-price")).toHaveCount(0);

    await ask(page, "3개월로 보여줘");
    const price = page.locator(".chat-price");
    await expect(price).toContainText("3개월 가격 요약 · 가격 기준일 2026.09.11");
    await expect(price).toContainText("구간 변화 +6,200원 · +9.54%");
    await expect(price).toContainText("요청 구간 2026.06.11~2026.09.11");
    await expect(price).toContainText("확인된 거래일 2026.06.12~2026.09.11");
  });

  test("대상을 바꾼 답변은 이전 종목 대화를 화면과 다음 요청에서 모두 버린다", async ({ page }) => {
    const sent = await mockChat(page, [
      {
        json: answer("a-samsung", {
          target: SAMSUNG,
          steps: ["종목 확인", "공시 확인"],
          verified: verified({ target: SAMSUNG, filings: filingsOf(SAMSUNG) }),
        }),
      },
      {
        json: answer("a-hynix", {
          target: HYNIX,
          steps: ["종목 확인", "공시 확인"],
          verified: verified({ target: HYNIX, filings: filingsOf(HYNIX) }),
        }),
      },
      { json: answer("a-followup", { target: HYNIX, status: { message: "확인했습니다.", nextActions: [] } }) },
    ]);
    await openChat(page);
    await ask(page, "삼성전자 최근 공시 1건 보여줘");
    await expect(page.locator(".chat-target")).toContainText("삼성전자 · 종목코드 005930");

    await ask(page, "SK하이닉스는 어때?");
    await expect(page.locator(".chat-target")).toHaveCount(1);
    await expect(page.locator(".chat-target")).toContainText("SK하이닉스 · 종목코드 000660");
    await expect(page.getByRole("heading", { level: 2 })).toContainText("SK하이닉스(종목코드 000660)");
    const log = page.locator(".chat-log");
    // 전환을 요청한 이번 질문은 남고, 이전 종목의 질문·근거는 남지 않는다.
    await expect(log).toContainText("SK하이닉스는 어때?");
    await expect(log).not.toContainText("삼성전자 최근 공시 1건 보여줘");
    await expect(log).not.toContainText("삼성전자 주요사항보고서");

    await ask(page, "그럼 그 공시는 무슨 뜻이야?");
    await expect(page.locator(".chat-scope")).toContainText("확인했습니다.");
    const history = sent[2].history as Array<{ text: string }>;
    expect(history.some((turn) => turn.text.includes("삼성전자"))).toBe(false);
    expect(sent[2].targetCode).toBe("000660");
  });

  test("후보를 골랐다가 서버가 확인하지 못하면 원래 질문과 후보 목록을 되돌린다", async ({ page }) => {
    const sent = await mockChat(page, [
      {
        json: answer("a-choose", {
          selection: {
            message: "어느 종목인지 골라 주세요.",
            searchQuery: "삼성전자",
            candidates: [SAMSUNG, SAMSUNG_PREFERRED],
            truncated: false,
            totalFound: 2,
          },
        }),
      },
      { status: 400, json: { error: "고른 종목을 다시 확인하지 못했습니다.", code: "CHAT_SELECTION_INVALID" } },
      {
        json: answer("a-retry", {
          target: SAMSUNG_PREFERRED,
          steps: ["종목 확인", "공시 확인"],
          verified: verified({ target: SAMSUNG_PREFERRED, filings: filingsOf(SAMSUNG_PREFERRED) }),
        }),
      },
    ]);
    await openChat(page);
    await ask(page, "삼성전자 최근 공시 보여줘");
    const candidate = page.getByRole("button", { name: /삼성전자우 · 005935/ });
    await expect(candidate).toBeVisible();

    await candidate.click();
    await expect(page.locator(".chat-error")).toContainText("고른 종목을 다시 확인하지 못했습니다.");
    // 실패했으니 고른 종목 안내는 사라지고, 다시 고를 수 있는 상태로 돌아온다.
    await expect(page.locator(".chat-note")).toHaveCount(0);
    await expect(page.locator(".chat-log")).toContainText("삼성전자 최근 공시 보여줘");
    await expect(candidate).toBeEnabled();

    await candidate.click();
    await expect(page.locator(".chat-target")).toContainText("삼성전자우 · 종목코드 005935");
    // 다시 시도해도 원래 질문을 그대로 보낸다. 새 질문을 만들어 보내지 않는다.
    expect(sent[2].question).toBe("삼성전자 최근 공시 보여줘");
    expect(sent[2].selection).toEqual({ searchQuery: "삼성전자", code: "005935" });
    expect(sent.length).toBe(3);
  });

  test("기다리는 요청을 취소하면 질문을 잃지 않고 다시 물어볼 수 있다", async ({ page }) => {
    let hold: (() => void) | null = null;
    /** 취소를 확인한 뒤에야 응답을 내보낸다. 늦게 온 응답이 붙지 않는지 보기 위해서다. */
    const releaseResponse = () => hold?.();
    await page.route("**/api/chat", async (route) => {
      await new Promise<void>((resolve) => {
        hold = resolve;
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(answer("a-late", { status: { message: "늦게 온 답변", nextActions: [] } })),
      });
    });
    await openChat(page);
    await ask(page, "변동성이 뭐야?");
    await expect(page.locator(".chat-state")).toContainText("답변을 준비하는 중입니다");

    await page.getByRole("button", { name: "요청 취소" }).click();
    await expect(page.locator(".chat-state")).toHaveText("");
    await expect(page.getByRole("textbox", { name: "질문" })).toHaveValue("변동성이 뭐야?");
    // 취소는 오류가 아니므로 오류 문구를 남기지 않고, 늦게 온 응답도 붙이지 않는다.
    await expect(page.locator(".chat-error")).toHaveCount(0);
    releaseResponse();
    await expect(page.locator(".chat-log")).not.toContainText("늦게 온 답변");
  });

  test("대화 레이어가 열린 동안 배경을 잠그고 Tab을 가두며 닫으면 포커스를 되돌린다", async ({ page }) => {
    await mockChat(page, [{ json: answer("a-noop", { status: { message: "확인", nextActions: [] } }) }]);
    await openChat(page, "/stocks/005930");
    await expect(page.locator(".page")).toHaveAttribute("inert", "");
    await expect(page.getByRole("textbox", { name: "질문" })).toBeFocused();

    for (let index = 0; index < 8; index += 1) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => document.activeElement?.closest(".chat-layer") !== null);
      expect(inside).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator(".page")).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "AI에게 질문" })).toBeFocused();
  });

  test("한글 조합 중의 Enter로는 보내지 않고 조합이 끝난 Enter로만 보낸다", async ({ page }) => {
    const sent = await mockChat(page, [{ json: answer("a-ime", { status: { message: "확인", nextActions: [] } }) }]);
    await openChat(page);
    const input = page.getByRole("textbox", { name: "질문" });
    await input.fill("변동성이 뭐야");
    // 조합 중 Enter는 글자를 확정하는 입력이다. 그때 보내면 조합이 끊긴다.
    await input.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    expect(sent.length).toBe(0);
    await expect(input).toHaveValue("변동성이 뭐야");

    await input.press("Enter");
    await expect(page.locator(".chat-scope")).toContainText("확인");
    expect(sent.length).toBe(1);
  });

  test("좁은 화면에서도 대화 레이어와 입력창이 보이는 영역 안에 있다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockChat(page, [{ json: answer("a-mobile", { status: { message: "확인", nextActions: [] } }) }]);
    await openChat(page, "/stocks/005930");

    const height = await page
      .locator(".chat-layer")
      .evaluate((element) => (element as HTMLElement).style.getPropertyValue("--chat-visual-height"));
    expect(height).not.toBe("");

    const box = await page.getByRole("textbox", { name: "질문" }).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(844);
    // 창 크기 시험은 실기기의 키보드·안전 여백과 다르다. 실제 앵커링은 기기에서 따로 확인해야 한다.
  });
});

test.describe("대화 기능을 명시적으로 끈 상태", () => {
  test.skip(chatEnabled, "CHAT_ENABLED=false로 실행할 때 확인한다.");

  test("버튼도 대화 레이어도 만들지 않는다", async ({ page }) => {
    for (const path of ["/", "/stocks/005930"]) {
      await page.goto(path);
      await expect(page.getByRole("button", { name: "AI에게 질문" })).toHaveCount(0);
      await expect(page.locator(".chat-layer")).toHaveCount(0);
    }
  });

  test("API를 직접 불러도 404로 끝나고 모델까지 가지 않는다", async ({ request }) => {
    const response = await request.post("/api/chat", {
      data: { question: "삼성전자 최근 공시 알려줘", history: [], routeCode: null, targetCode: null, selection: null },
    });
    expect(response.status()).toBe(404);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe("CHAT_DISABLED");
  });
});
