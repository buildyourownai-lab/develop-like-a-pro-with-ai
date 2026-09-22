import { timingSafeEqual } from "node:crypto";

/**
 * Who is allowed to make an auto-reply request.
 *
 * Two callers exist, and they get different treatment:
 *
 *   - the scheduler (POST /api/auto-reply/run). Nobody is at a keyboard, so
 *     the only thing that can identify it is a shared secret. Without
 *     AUTO_REPLY_SCHEDULER_SECRET set, this endpoint is refused ALWAYS —
 *     including locally. An unauthenticated endpoint that can send a real
 *     reply must not be reachable at any time.
 *
 *   - the operator (enable / send / stop). In production a secret is required
 *     for the same reason. Locally, where the app is bound to 127.0.0.1 (see
 *     src/app/loopback-only-server.test.ts), the secret is optional so a
 *     beginner can follow the chapter without inventing one.
 *
 * The secret travels in the Authorization header only. It is never a query
 * parameter, never in a path, and never logged — the failure results below
 * carry a reason label, not the value that was tried.
 */

export const AUTH_FAILURE_REASONS = [
  /** No secret configured on the server, so no request can be trusted. */
  "secret_not_configured",
  /** No Authorization header, or not a Bearer one. */
  "missing_credentials",
  /** A Bearer token that does not match. */
  "invalid_credentials",
] as const;
export type AuthFailureReason = (typeof AUTH_FAILURE_REASONS)[number];

export type AuthResult =
  | { authorized: true }
  | { authorized: false; reason: AuthFailureReason; status: number };

/** Fixed Korean messages. None of them says which secret or how it differed. */
export const AUTH_FAILURE_MESSAGE: Record<AuthFailureReason, string> = {
  secret_not_configured: "서버에 자동답글 실행 열쇠가 아직 설정되지 않았습니다.",
  missing_credentials: "이 요청에는 실행 열쇠가 필요합니다.",
  invalid_credentials: "실행 열쇠가 맞지 않습니다.",
};

function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (header === null) return null;
  const match = /^Bearer (.+)$/.exec(header.trim());
  return match === null ? null : (match[1] ?? null);
}

/**
 * Compares in constant time so the number of leading characters that matched
 * cannot be measured. Length is compared first because timingSafeEqual throws
 * on differing lengths — that leaks only the length, not the content.
 */
function secretMatches(provided: string, expected: string): boolean {
  const providedBytes = Buffer.from(provided, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (providedBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(providedBytes, expectedBytes);
}

function authorizeAgainst(request: Request, expected: string | undefined): AuthResult {
  if (!expected) {
    // 503, not 401: the caller did nothing wrong, the server is not ready.
    return { authorized: false, reason: "secret_not_configured", status: 503 };
  }
  const provided = readBearerToken(request);
  if (provided === null) {
    return { authorized: false, reason: "missing_credentials", status: 401 };
  }
  if (!secretMatches(provided, expected)) {
    return { authorized: false, reason: "invalid_credentials", status: 401 };
  }
  return { authorized: true };
}

/** The scheduled run endpoint. Always requires the scheduler secret. */
export function authorizeSchedulerRequest(request: Request): AuthResult {
  return authorizeAgainst(request, process.env.AUTO_REPLY_SCHEDULER_SECRET);
}

/**
 * The operator endpoints. Required in production; optional locally, but
 * enforced as soon as AUTO_REPLY_OPERATOR_SECRET is set, so setting it never
 * silently does nothing.
 */
export function authorizeOperatorRequest(request: Request): AuthResult {
  const expected = process.env.AUTO_REPLY_OPERATOR_SECRET;
  if (!expected && process.env.NODE_ENV !== "production") {
    return { authorized: true };
  }
  return authorizeAgainst(request, expected);
}
