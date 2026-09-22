import { jsonResponse } from "../http";
import { STORE_ERROR_MESSAGE, classifyStoreError } from "./errors";
import { AUTO_REPLY_CONFIG_MESSAGE, hasAutoReplyConfig } from "./real-deps";
import {
  AUTH_FAILURE_MESSAGE,
  authorizeOperatorRequest,
  authorizeSchedulerRequest,
} from "./request-auth";

/**
 * The checks every auto-reply route runs before it does anything, kept here so
 * all five routes cannot drift apart. Each returns a Response to send back, or
 * null to mean "carry on".
 *
 * The order matters and is the same everywhere: authorize first, then check
 * configuration. An unauthorized caller must not be able to learn from the
 * response whether the server is configured.
 */

export function guardOperatorRequest(request: Request): Response | null {
  const auth = authorizeOperatorRequest(request);
  if (auth.authorized) return null;
  return jsonResponse(
    { status: "error", reason: auth.reason, message: AUTH_FAILURE_MESSAGE[auth.reason] },
    auth.status,
  );
}

export function guardSchedulerRequest(request: Request): Response | null {
  const auth = authorizeSchedulerRequest(request);
  if (auth.authorized) return null;
  return jsonResponse(
    { status: "error", reason: auth.reason, message: AUTH_FAILURE_MESSAGE[auth.reason] },
    auth.status,
  );
}

export function guardConfig(): Response | null {
  if (hasAutoReplyConfig()) return null;
  return jsonResponse(
    { status: "error", reason: "config_missing", message: AUTO_REPLY_CONFIG_MESSAGE },
    500,
  );
}

/**
 * Turns any failure from the state store or an unexpected throw into a fixed
 * message. The caught value's own message is never read, because it can hold
 * the store URL or the service role key.
 */
export function storeFailureResponse(error: unknown): Response {
  const reason = classifyStoreError(error);
  return jsonResponse(
    { status: "error", reason, message: STORE_ERROR_MESSAGE[reason] },
    reason === "store_config_missing" ? 500 : 502,
  );
}

/** Reads a JSON body field as a non-empty string, or null. */
export async function readStringFields<K extends string>(
  request: Request,
  keys: readonly K[],
): Promise<Partial<Record<K, string>> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  const result: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      result[key] = value.trim();
    }
  }
  return result;
}
