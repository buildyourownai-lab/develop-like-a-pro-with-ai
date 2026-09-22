import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const envText = (() => {
  try { return readFileSync(join(process.cwd(), ".env.local"), "utf8"); } catch { return ""; }
})();
const secretNames = [
  "DATA_GO_KR_SERVICE_KEY", "OPEN_DART_API_KEY", "GEMINI_API_KEY",
  "SUPABASE_DATABASE_URL", "POSTGRES_URL", "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN", "KV_REST_API_URL", "KV_REST_API_TOKEN",
];
const secretValues = secretNames
  .map((name) => new RegExp(`^${name}=(.+)$`, "m").exec(envText)?.[1].trim().replace(/^['\"]|['\"]$/g, ""))
  .filter((value) => value && value.length >= 8);
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: process.cwd() }).trim().split("\n");
const files = [...new Set(tracked)].filter(Boolean);
const findings = [];
for (const file of files) {
  let text;
  try { text = readFileSync(join(process.cwd(), file), "utf8"); } catch { continue; }
  if (secretValues.some((value) => text.includes(value))) findings.push({ file, rule: "known-secret-value" });
  if (/\b(?:postgres(?:ql)?|rediss?):\/\/[^\s"']+:[^\s"']+@/i.test(text)) findings.push({ file, rule: "credential-in-url" });
  if (/AIza[A-Za-z0-9_-]{20,}/.test(text)) findings.push({ file, rule: "google-api-key" });
}
const result = {
  measuredAt: new Date().toISOString(),
  scannedFiles: files.length,
  knownSecretValuesLoaded: secretValues.length,
  findings,
  status: findings.length === 0 ? "PASS" : "FAIL",
};
console.log(JSON.stringify(result, null, 2));
if (findings.length > 0) process.exitCode = 1;
