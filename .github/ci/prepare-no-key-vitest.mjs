import { copyFileSync, writeFileSync } from "node:fs";

// Run from a stock chapter's project directory. Keep its normal discovery,
// aliases, setup, and npm pretest build; add only the no-key CI boundary.
copyFileSync(new URL("./no-key-vitest-setup.ts", import.meta.url), ".ci-vitest-setup.ts");
writeFileSync(".ci-vitest.config.mts", `import base from "./vitest.config.mts";
export default {
  ...base,
  test: {
    ...base.test,
    setupFiles: [...(base.test?.setupFiles ?? []), "./.ci-vitest-setup.ts"],
    sequence: { ...base.test?.sequence, setupFiles: "list", hooks: "list" },
  },
};
`);
