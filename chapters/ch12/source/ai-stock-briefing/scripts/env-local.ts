import fs from "node:fs";
import path from "node:path";

function stripQuotes(value: string): string {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? value.slice(1, -1) : value;
}

// /setup 화면에서 저장한 값은 항상 큰따옴표로 감싸져 있어, 그 따옴표를
// 벗겨내야 실제 값과 같아진다.
export function loadEnvLocal(): void {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = stripQuotes(trimmed.slice(idx + 1).trim());
    if (!(key in process.env)) process.env[key] = value;
  }
}
