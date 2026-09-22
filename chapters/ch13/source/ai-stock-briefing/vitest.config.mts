import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  test: {
    setupFiles: ["./tests/setup-env.ts"],
    // 실제 금융위원회 API를 부르는 테스트가 섞여 있어 기본 시간보다 넉넉하게 둔다.
    testTimeout: 30000,
    // 테스트 파일을 동시에 여러 개 돌리면 실제 금융위원회 API가 짧은 시간에
    // 몰리는 요청을 제한(rate limit)해 무작위로 실패한다 — 실제로 반복
    // 실행해 확인했다. 파일을 하나씩 순서대로 돌려 이 문제를 피한다(전체
    // 시간은 조금 늘지만, 실행할 때마다 결과가 달라지는 것보다 낫다).
    fileParallelism: false,
    // tests/e2e는 Playwright(`npm run test:e2e`)가 담당한다.
    exclude: ["**/node_modules/**", "tests/e2e/**"],
  },
});
