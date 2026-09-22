/*
 * 22장 대화 화면 시험을 **켠 상태**(`on`)와 **끈 상태**(`off`) 어느 쪽으로 돌릴지 이 runner가 정한다.
 *
 *   node scripts/run-chat-e2e.mjs on   [playwright 인수...]   → CHAT_ENABLED=true
 *   node scripts/run-chat-e2e.mjs off  [playwright 인수...]   → CHAT_ENABLED=false
 *
 * `CHAT_ENABLED=true playwright test ...`처럼 명령 앞에 환경변수를 붙이는 방식은 sh 계열
 * 셸에서만 동작해서 Windows `cmd.exe`의 npm에서는 실패한다. 그래서 값을 셸이 아니라
 * Node가 자식 프로세스 환경에 넣고, Playwright도 셸을 거치지 않고 CLI 파일을 직접 부른다.
 * 새 package는 쓰지 않는다.
 *
 * 두 mode 모두 **값을 명시한다**. 특히 끈 상태는 `CHAT_ENABLED=false`를 직접 넣는다. 셸에
 * `CHAT_ENABLED=true`가 남아 있어도 끈 상태 확인이 조용히 건너뛰어지지 않게 하기 위해서다.
 *
 * `CHAT_E2E_MODE`는 "지금은 22장 대화 시험이다"라는 표시다. `playwright.config.ts`가 이 값을
 * 보고 **대화 시험 서버에만** AI 열쇠를 비운다(격리). 화면 시험은 응답을 대신 만들어(mock)
 * 확인하므로 실제 AI를 부를 필요가 없고, 열쇠가 없으면 실수로 부를 수도 없다. 다른 시험
 * 명령에는 이 표시가 없으므로 기존 설정이 그대로 쓰인다.
 *
 * Playwright 서버는 `reuseExistingServer: false`라서 이미 떠 있는 다른 mode의 서버를
 * 그대로 쓰지 않고 매번 새로 띄운다. 켠 상태와 끈 상태를 섞어 확인할 수 없다.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MODES = { on: "true", off: "false" };

const [rawMode, ...passThrough] = process.argv.slice(2);
const mode = rawMode ?? "on";
if (!Object.hasOwn(MODES, mode)) {
  console.error(`알 수 없는 mode입니다: ${rawMode}\n사용법: node scripts/run-chat-e2e.mjs <on|off> [playwright 인수...]`);
  process.exit(2);
}

const projectDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");

const child = spawn(
  process.execPath,
  [playwrightCli, "test", "tests/chapter-22-chat.spec.ts", ...passThrough],
  {
    cwd: projectDir,
    // 셸이 무엇을 들고 있든 이 두 값은 여기서 정한 값으로 덮는다.
    env: { ...process.env, CHAT_E2E_MODE: mode, CHAT_ENABLED: MODES[mode] },
    stdio: "inherit",
  }
);

child.on("exit", (code, signal) => {
  // 신호로 끝났으면 종료 코드 0으로 감추지 않는다.
  process.exit(signal ? 1 : (code ?? 1));
});
