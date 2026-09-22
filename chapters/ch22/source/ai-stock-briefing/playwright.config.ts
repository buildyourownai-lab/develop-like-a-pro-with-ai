import { defineConfig } from "@playwright/test";

/**
 * 22장 대화 시험 mode. `scripts/run-chat-e2e.mjs`만 이 값을 넣는다(`on`·`off`).
 * 다른 시험 명령에는 이 값이 없으므로 아래 격리도 적용되지 않는다.
 */
const chatTestMode =
  process.env.CHAT_E2E_MODE === "on" || process.env.CHAT_E2E_MODE === "off" ? process.env.CHAT_E2E_MODE : null;

/**
 * 대화 시험 서버에만 넣는 **빈 값**이다. 22장 화면 시험은 `/api/chat` 응답을 브라우저에서
 * 대신 만들어(mock) 확인하므로 실제 AI를 부르지 않는다고 적어 두었다. 그 약속을 문장이 아니라
 * 환경으로 지키려고, 시험 서버에는 실제 AI를 부를 수 있는 열쇠 자체를 두지 않는다.
 *
 * 빈 문자열을 쓰는 이유:
 * - Next의 환경변수 적재 순서는 `process.env`가 가장 먼저다(문서
 *   `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`의
 *   "Environment Variable Load Order", 2026-09-14 확인). 즉 여기서 넘긴 값이 있으면
 *   `.env.local`의 같은 이름 값이 적용되지 않는다.
 * - 그리고 `@next/env`는 시작 시 값이 빈 문자열인 항목을 `process.env`에서 지운다
 *   (`node_modules/@next/env/dist/index.js`의 `replaceProcessEnv`). 그래서 시험 서버는 AI 열쇠가
 *   "설정 없음"인 상태가 된다.
 *
 * 이 파일은 독자의 `.env.local`을 읽지도, 바꾸지도, 지우지도 않는다. 그 파일은 그대로 두고
 * 이 시험 서버의 환경만 비운다.
 */
const CHAT_TEST_ISOLATION = { GEMINI_API_KEY: "" } as const;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  reporter: "line",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3200",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "CHAPTER12_MEASUREMENT_TOKEN=chapter12-e2e npm run start -- --hostname 127.0.0.1 --port 3200",
    // 대화 기능은 기본으로 켜진다. 22장 시험은 runner가 켠 상태(`on`)·끈 상태(`off`)를 값으로
    // 명시하고, 그때만 위 격리를 함께 넣는다. 다른 시험은 기존 동작 그대로다.
    env: chatTestMode
      ? { ...CHAT_TEST_ISOLATION, CHAT_ENABLED: chatTestMode === "on" ? "true" : "false" }
      : { CHAT_ENABLED: process.env.CHAT_ENABLED ?? "" },
    url: "http://127.0.0.1:3200",
    // 남아 있는 서버를 그냥 쓰면 예전 build 결과를 검사하게 된다. 매번 새로 띄운다.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
