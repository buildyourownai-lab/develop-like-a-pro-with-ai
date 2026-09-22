import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MODEL_CALL_LIMIT,
  CHAT_TOTAL_TIME_LIMIT_MS,
  ChatBudgetExceededError,
  ChatCallBudget,
} from "../../src/lib/chat-budget";
import { runChatTurn } from "../../src/lib/chat-answer";

test("모델 호출은 초기 상한 3회까지만 예약된다", () => {
  const budget = new ChatCallBudget();
  for (let index = 0; index < CHAT_MODEL_CALL_LIMIT; index += 1) {
    assert.ok(budget.reserveModelCall().timeoutMs > 0);
  }
  assert.throws(() => budget.reserveModelCall(), (caught: unknown) => {
    assert.ok(caught instanceof ChatBudgetExceededError);
    assert.equal(caught.reason, "model_calls");
    return true;
  });
  assert.deepEqual(budget.usage(), { modelCalls: CHAT_MODEL_CALL_LIMIT, lookups: 0 });
});

test("조회 실행은 모델 호출과 다른 수로 센다", () => {
  const budget = new ChatCallBudget({ modelCalls: 1, lookups: 2 });
  budget.reserveModelCall();
  budget.reserveLookup();
  budget.reserveLookup();
  assert.deepEqual(budget.usage(), { modelCalls: 1, lookups: 2 });
  assert.throws(() => budget.reserveLookup(), ChatBudgetExceededError);
});

test("전체 30초가 지나면 남은 호출 수가 있어도 새 호출을 시작하지 않는다", () => {
  let now = 1_000;
  const budget = new ChatCallBudget({ now: () => now });
  assert.equal(budget.remainingMs(), CHAT_TOTAL_TIME_LIMIT_MS);
  now += CHAT_TOTAL_TIME_LIMIT_MS - 1;
  assert.equal(budget.reserveModelCall().timeoutMs, 1);
  now += 1;
  assert.throws(() => budget.reserveModelCall(), (caught: unknown) => {
    assert.ok(caught instanceof ChatBudgetExceededError);
    assert.equal(caught.reason, "time");
    return true;
  });
});

test("시간이 끝난 뒤에는 모델을 호출하지 않고 답변을 멈춘다", async () => {
  let called = false;
  await assert.rejects(
    runChatTurn(
      { question: "변동성이 뭐야?", history: [], routeCode: null, targetCode: null, selection: null },
      {
        sendTurn: async () => {
          called = true;
          throw new Error("호출해서는 안 된다");
        },
        lookups: {
          searchStocks: async () => {
            throw new Error("조회해서는 안 된다");
          },
          listFilings: async () => {
            throw new Error("조회해서는 안 된다");
          },
          priceSource: async () => {
            throw new Error("조회해서는 안 된다");
          },
        },
        budget: new ChatCallBudget({ totalTimeMs: 0 }),
        requestId: "req-time",
      }
    ),
    ChatBudgetExceededError
  );
  assert.equal(called, false);
});

test("withDeadline은 남은 시간만큼만 기다리고 늦은 실패를 관측해 둔다", async () => {
  const budget = new ChatCallBudget({ totalTimeMs: 20 });
  let lateSettled = false;
  // 기존 조회 함수는 abort signal을 받지 않으므로, 끊은 뒤에도 계속 돌다가 늦게 끝날 수 있다.
  const late = new Promise<string>((_resolve, reject) => {
    setTimeout(() => {
      lateSettled = true;
      reject(new Error("늦게 도착한 실패"));
    }, 200);
  });

  const started = Date.now();
  await assert.rejects(budget.withDeadline(late), (caught: unknown) => {
    assert.ok(caught instanceof ChatBudgetExceededError);
    assert.equal(caught.reason, "time");
    return true;
  });
  assert.ok(Date.now() - started < 150, "실제로 30초를 기다리지 않는다");
  assert.equal(lateSettled, false);

  // 늦은 rejection은 이미 관측해 두었으므로 unhandled rejection으로 남지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.equal(lateSettled, true);
  assert.equal(budget.remainingMs(), 0);
});

test("시간이 남아 있으면 withDeadline은 결과를 그대로 돌려주고 timer를 남기지 않는다", async () => {
  const budget = new ChatCallBudget({ totalTimeMs: 1_000 });
  const started = Date.now();
  assert.equal(await budget.withDeadline(Promise.resolve("결과")), "결과");
  // timer를 정리하지 않으면 요청이 남은 시간만큼 늦게 끝난다.
  assert.ok(Date.now() - started < 100);
});
