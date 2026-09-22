import assert from "node:assert/strict";
import test from "node:test";

import {
  CHAT_MAX_TOOL_CALLS_PER_TURN,
  CHAT_TOOL_DECLARATIONS,
  CHAT_TOOL_NAMES,
  ChatToolCallRejectedError,
  chatToolCallKey,
  validateChatToolCall,
} from "../../src/lib/chat-tools";

test("허용하는 기능 이름은 세 개뿐이다", () => {
  assert.deepEqual([...CHAT_TOOL_NAMES], ["find_stock", "list_disclosures", "get_price_summary"]);
  assert.equal(CHAT_TOOL_DECLARATIONS.length, 3);
  for (const declaration of CHAT_TOOL_DECLARATIONS) {
    // 선언에 없는 입력 항목은 모델에도 열어 주지 않는다.
    assert.equal(declaration.parametersJsonSchema.additionalProperties, false);
  }
  assert.equal(CHAT_MAX_TOOL_CALLS_PER_TURN, 4);
});

test("목록에 없는 이름은 거절한다", () => {
  const reject = (name: unknown) =>
    assert.throws(() => validateChatToolCall(name, {}), ChatToolCallRejectedError);
  reject("read_filing_document");
  reject("fetch_url");
  reject("find_stock ");
  reject("FIND_STOCK");
  reject(null);
  reject(42);
});

test("검색어는 회사명·종목코드 형태만 받는다", () => {
  assert.deepEqual(validateChatToolCall("find_stock", { query: " 삼성전자 " }), {
    name: "find_stock",
    args: { query: "삼성전자" },
  });
  assert.deepEqual(validateChatToolCall("find_stock", { query: "005930" }).args, { query: "005930" });

  const reject = (args: Record<string, unknown>) =>
    assert.throws(() => validateChatToolCall("find_stock", args), ChatToolCallRejectedError);
  reject({ query: "" });
  reject({ query: "   " });
  reject({ query: "가".repeat(51) });
  reject({ query: "삼성전자'; DROP TABLE stocks;--" });
  reject({ query: "https://dart.fss.or.kr/x" });
  reject({ query: "../../etc/passwd" });
  reject({ query: "삼성전자 | curl example.test" });
  reject({ query: "삼성전자; ls" });
  // 회사명에 실제로 쓰이는 `&`·`.`·`-`는 남긴다.
  assert.deepEqual(validateChatToolCall("find_stock", { query: "S&T모티브" }).args, { query: "S&T모티브" });
  reject({ query: 5 });
  reject({ query: "삼성전자", limit: 5 });
  reject({});
});

test("공시 조회는 종목코드 형식과 1~5건만 받는다", () => {
  assert.deepEqual(validateChatToolCall("list_disclosures", { stockCode: "005930" }).args, {
    stockCode: "005930",
    limit: 5,
  });
  assert.deepEqual(validateChatToolCall("list_disclosures", { stockCode: "005930", limit: 2 }).args, {
    stockCode: "005930",
    limit: 2,
  });

  const reject = (args: Record<string, unknown>) =>
    assert.throws(() => validateChatToolCall("list_disclosures", args), ChatToolCallRejectedError);
  reject({ stockCode: "5930" });
  reject({ stockCode: "삼성전자" });
  reject({ stockCode: "005930", limit: 0 });
  reject({ stockCode: "005930", limit: 6 });
  reject({ stockCode: "005930", limit: 2.5 });
  reject({ stockCode: "005930", from: "20200101" }); // 임의 기간은 열지 않는다
});

test("가격 요약의 기간 요약 방식은 달력 1·3·12개월만 받는다", () => {
  // 기간이 있으면 흐름 요약을 뜻한 것이 분명하므로 방식을 밝히지 않아도 range로 읽는다.
  assert.deepEqual(validateChatToolCall("get_price_summary", { stockCode: "005930", period: "3m" }).args, {
    stockCode: "005930",
    mode: "range",
    period: "3m",
  });
  assert.deepEqual(
    validateChatToolCall("get_price_summary", { stockCode: "005930", mode: "range", period: "1m" }).args,
    { stockCode: "005930", mode: "range", period: "1m" }
  );

  const reject = (args: Record<string, unknown>) =>
    assert.throws(() => validateChatToolCall("get_price_summary", args), ChatToolCallRejectedError);
  reject({ stockCode: "005930" }); // 방식도 기간도 없으면 서버가 고르지 않는다
  reject({ stockCode: "005930", mode: "range" }); // 흐름 요약에는 기간이 필요하다
  reject({ stockCode: "005930", period: "6m" });
  reject({ stockCode: "005930", mode: "month" });
  reject({ stockCode: "005930", period: "1m", from: "20260101" });
});

test("최근 확인 종가만 필요한 질문은 기간 없이 받는다", () => {
  // 기간을 억지로 채우게 하지 않는다. 이 방식에는 기간이라는 개념이 없다.
  assert.deepEqual(validateChatToolCall("get_price_summary", { stockCode: "005930", mode: "latest" }).args, {
    stockCode: "005930",
    mode: "latest",
  });
  // 함께 온 기간은 쓰지 않는다. 요청하지 않은 기간 요약을 만들지 않기 위해서다.
  assert.deepEqual(
    validateChatToolCall("get_price_summary", { stockCode: "005930", mode: "latest", period: "12m" }).args,
    { stockCode: "005930", mode: "latest" }
  );
  // 최근 종가와 기간 요약은 서로 다른 요청이므로 결과를 재사용하지 않는다.
  assert.notEqual(
    chatToolCallKey(validateChatToolCall("get_price_summary", { stockCode: "005930", mode: "latest" })),
    chatToolCallKey(validateChatToolCall("get_price_summary", { stockCode: "005930", period: "12m" }))
  );
});

test("입력이 객체가 아니면 실행 후보로 보지 않는다", () => {
  assert.throws(() => validateChatToolCall("find_stock", "삼성전자"), ChatToolCallRejectedError);
  assert.throws(() => validateChatToolCall("find_stock", ["삼성전자"]), ChatToolCallRejectedError);
  // 인자를 주지 않은 호출은 검색어 없음으로 거절된다.
  assert.throws(() => validateChatToolCall("find_stock", undefined), ChatToolCallRejectedError);
});

test("중복 제거 key는 검증된 입력으로만 만든다", () => {
  const first = chatToolCallKey(validateChatToolCall("find_stock", { query: "삼성전자" }));
  const second = chatToolCallKey(validateChatToolCall("find_stock", { query: " 삼성전자 " }));
  assert.equal(first, second);
  assert.notEqual(
    chatToolCallKey(validateChatToolCall("list_disclosures", { stockCode: "005930", limit: 5 })),
    chatToolCallKey(validateChatToolCall("list_disclosures", { stockCode: "005930", limit: 3 }))
  );
  assert.notEqual(
    chatToolCallKey(validateChatToolCall("list_disclosures", { stockCode: "005930", limit: 5 })),
    chatToolCallKey(validateChatToolCall("get_price_summary", { stockCode: "005930", period: "1m" }))
  );
});
