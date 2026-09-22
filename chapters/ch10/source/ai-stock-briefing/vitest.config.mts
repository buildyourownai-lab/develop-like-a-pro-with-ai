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
    // tests/e2e는 Playwright(`npm run test:e2e`)가 담당한다.
    exclude: ["**/node_modules/**", "tests/e2e/**"],
  },
});
