import { afterAll, beforeEach, expect } from "vitest";

// This setup belongs only to secret-free CI. Reader runs keep their normal
// config and can verify the real FSC/DART APIs using their own credentials.
// Reject unexpected requests instead of letting a new live test reach a service.
let unexpectedRequests = 0;
globalThis.fetch = async () => {
  unexpectedRequests += 1;
  throw new Error("Unexpected network request in no-key CI; mock it or mark the live check explicitly.");
};
// An application's fallback must not silently turn a blocked request into PASS.
afterAll(() => {
  expect(unexpectedRequests, "Unmocked network requests in no-key CI").toBe(0);
});

const liveFiles = new Set([
  "market-data.test.ts",       // FSC market data
  "stock-lookup.test.ts",      // FSC search/prices, plus one offline fixture
  "dart-disclosure.test.ts",   // DART API/viewer, plus a pure type-code check
  "briefing-actions.test.ts",  // Gemini is mocked, but FSC/DART are live
  "api-routes.test.ts",        // Live FSC/DART, except empty search validation
]);

beforeEach((context) => {
  const filepath = context.task.file.filepath.replaceAll("\\", "/");
  const filename = filepath.split("/").pop();
  // Only ch09–11 require actual nonempty .env.local values for this one case.
  // Keep their server-only import and variable-name assertions enabled.
  const requiredKeyChapter = /\/chapters\/ch(09|10|11)\/source\/[^/]+\/tests\/server-only-key\.test\.ts$/.exec(filepath)?.[1];
  const requiredKeyCase = requiredKeyChapter === "11"
    ? "빌드된 클라이언트 자바스크립트에 세 인증키 값이 포함되지 않는다"
    : "빌드된 클라이언트 자바스크립트에 인증키 값이 포함되지 않는다";
  if (requiredKeyChapter && context.task.name === requiredKeyCase) {
    context.skip("Actual-key bundle verification requires the reader's nonempty .env.local values; unavailable in no-key CI.");
  }
  if (!filename || !liveFiles.has(filename)) return;

  // Retain offline assertions inside mixed integration files.
  if (filename === "stock-lookup.test.ts" && context.task.name === "상장 이력이 짧은 응답은 없는 거래일을 채워 넣지 않는다 (고정 응답)") return;
  if (filename === "dart-disclosure.test.ts" && context.task.name === "공식 코드(A~J)만 유효하다고 판단한다") return;
  if (filename === "api-routes.test.ts" && context.task.name === "검색어가 없으면 400을 돌려준다") return;

  context.skip("Live FSC/DART/viewer verification requires the reader's own keys and network; not run in no-key CI.");
});
