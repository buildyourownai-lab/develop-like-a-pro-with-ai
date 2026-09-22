import { createServer } from "node:http";
import { parseCallbackRequest } from "./oauth-callback.mjs";

/**
 * Fixed, safe text sent to the browser for each outcome. Never built by
 * interpolating anything from the request (query params, the provider's
 * `error`/`error_description`, or outcome.message) — that value is
 * attacker-reachable at this localhost endpoint and must not be reflected
 * into the response.
 */
const BROWSER_TEXT_BY_REASON = {
  cancelled: "동의 화면에서 취소했습니다. 이 창을 닫고 터미널로 돌아가세요.",
  provider_error: "Google이 오류를 반환했습니다. 이 창을 닫고 터미널로 돌아가세요.",
  state_mismatch: "state 값이 일치하지 않습니다. 이 창을 닫고 터미널로 돌아가세요.",
  missing_code: "인가 코드가 없습니다. 이 창을 닫고 터미널로 돌아가세요.",
  malformed_request: "요청 형식이 올바르지 않습니다. 이 창을 닫고 터미널로 돌아가세요.",
  missing_expected_state: "내부 오류가 발생했습니다. 이 창을 닫고 터미널로 돌아가세요.",
};
const BROWSER_TEXT_OK = "인증이 완료되었습니다. 이 창을 닫고 터미널로 돌아가세요.";
const BROWSER_TEXT_DEFAULT_FAILURE = "인증을 완료하지 못했습니다. 이 창을 닫고 터미널로 돌아가세요.";

/**
 * Starts the local HTTP server that waits for exactly one OAuth redirect.
 * Returns before the callback arrives. Callers await `ready` first — it
 * always settles (to {ok:true} once listening, or {ok:false, reason, message}
 * if the server fails to start, e.g. the port is already in use) so a port
 * conflict can never hang the caller. Callers then await `result` for the
 * classified outcome of the callback itself (ok, cancelled, state_mismatch,
 * timeout, port error). Never logs the incoming URL (it may contain the
 * authorization code) or anything from the request beyond what
 * parseCallbackRequest classifies.
 */
export function startCallbackServer({ port, path, expectedState, timeoutMs = 5 * 60 * 1000 }) {
  let settled = false;
  let resolveResult;
  const result = new Promise((resolve) => {
    resolveResult = resolve;
  });

  let readySettled = false;
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  function settleReady(outcome) {
    if (readySettled) return;
    readySettled = true;
    resolveReady(outcome);
  }

  function settle(outcome) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close();
    resolveResult(outcome);
  }

  const server = createServer((req, res) => {
    if (settled) {
      res.writeHead(410).end();
      return;
    }
    let requestPath;
    try {
      requestPath = new URL(req.url, "http://127.0.0.1").pathname;
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (requestPath !== path) {
      res.writeHead(404).end();
      return;
    }

    const outcome = parseCallbackRequest(req.url, expectedState);
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      outcome.ok
        ? BROWSER_TEXT_OK
        : BROWSER_TEXT_BY_REASON[outcome.reason] ?? BROWSER_TEXT_DEFAULT_FAILURE,
    );
    settle(outcome);
  });

  server.on("error", (error) => {
    const outcome = {
      ok: false,
      reason: "server_error",
      message: `로컬 서버를 시작하지 못했습니다 (포트 ${port}): ${error.message}`,
    };
    settleReady(outcome);
    settle(outcome);
  });

  const timer = setTimeout(() => {
    settle({ ok: false, reason: "timeout", message: "시간 안에 동의를 완료하지 못했습니다." });
  }, timeoutMs);

  server.once("listening", () => {
    settleReady({ ok: true });
  });

  server.listen(port, "127.0.0.1");

  return {
    result,
    ready,
    address: () => server.address(),
    cancel: () => settle({ ok: false, reason: "cancelled", message: "사용자가 취소했습니다." }),
  };
}
