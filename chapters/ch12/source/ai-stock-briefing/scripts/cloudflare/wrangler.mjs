import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.exit(result.status ?? 1);
