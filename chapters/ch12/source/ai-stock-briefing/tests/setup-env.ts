import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";

// "server-only"는 조건부 export(react-server)로 클라이언트 유입을 막는데,
// vitest는 그 조건을 붙이지 않아 그대로 부르면 에러가 난다. 테스트에서는
// 그 가드 자체를 검증하는 게 아니라 서버 전용 함수의 동작을 보는 것이므로
// 이 모듈만 빈 구현으로 바꿔준다.
vi.mock("server-only", () => ({}));

function stripQuotes(value: string): string {
  const isDoubleQuoted = value.startsWith('"') && value.endsWith('"');
  const isSingleQuoted = value.startsWith("'") && value.endsWith("'");
  return isDoubleQuoted || isSingleQuoted ? value.slice(1, -1) : value;
}

// vitest는 Next.js와 달리 .env.local을 자동으로 읽지 않아서, 실제 API를
// 부르는 테스트가 인증키를 찾도록 직접 로드해준다. /setup 화면에서 저장한
// 값은 큰따옴표로 감싸져 있어 그 따옴표를 벗겨내야 실제 값과 같아진다.
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
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
