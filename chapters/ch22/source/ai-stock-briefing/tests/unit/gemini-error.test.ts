import assert from "node:assert/strict";
import test from "node:test";

import { classifyGeminiCallError } from "../../src/lib/gemini-error";

test("Gemini 호출 한도 오류를 인증·모델·일반 연결 오류와 구분한다", () => {
  assert.equal(classifyGeminiCallError({ status: 429, message: "RESOURCE_EXHAUSTED" }), "quota");
  assert.equal(classifyGeminiCallError({ statusCode: 429 }), "quota");
  assert.equal(classifyGeminiCallError(new Error("Quota exceeded for requests")), "quota");
  assert.equal(classifyGeminiCallError({ status: 401 }), "authentication");
  assert.equal(classifyGeminiCallError({ status: 404 }), "model");
  assert.equal(classifyGeminiCallError({ name: "AbortError" }), "timeout");
  assert.equal(classifyGeminiCallError({ status: 500 }), "call");
});
