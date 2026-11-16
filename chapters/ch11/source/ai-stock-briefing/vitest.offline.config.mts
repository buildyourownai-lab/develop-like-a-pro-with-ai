import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } }, test: { include: ["tests/offline/*.test.ts", "tests/briefing-verify.test.ts"], setupFiles: ["tests/offline/setup.ts"], fileParallelism: false } });
