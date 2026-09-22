import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  // 실제 금융위원회·OpenDART·Gemini API를 부르는 테스트가 섞여 있다.
  // 워커를 여러 개 띄우면 같은 API에 짧은 시간에 요청이 몰려 금융위원회
  // API가 무작위로 rate limit을 걸었다 — 실제로 반복 실행해 확인했다.
  // 워커 하나로 순서대로 돌려 이 문제를 피한다.
  workers: 1,
  webServer: {
    command: "npm run build && npm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
