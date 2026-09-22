import { defineConfig } from "@playwright/test";

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
    url: "http://127.0.0.1:3200",
    // 남아 있는 서버를 그냥 쓰면 예전 build 결과를 검사하게 된다. 매번 새로 띄운다.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
