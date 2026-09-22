import { isCommentCategory } from "../comments/types";
import { ClassifyOutput, ContextCheckOutput, DraftOutput } from "./types";

/**
 * Thrown for any Gemini response that does not match the exact shape this
 * app expects. Every throw site here is deliberate fail-closed behavior:
 * callers must not coerce a malformed value (a string "false", a number,
 * an array) into a safe-looking boolean or string — that is how the old
 * Boolean(...)/String(...) coercions silently turned failures into passes.
 */
export class GeminiSchemaError extends Error {}

function parseJsonObject(text: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new GeminiSchemaError("Gemini 응답이 JSON 형식이 아닙니다.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new GeminiSchemaError("Gemini 응답이 JSON 객체가 아닙니다.");
  }
  return value as Record<string, unknown>;
}

export function parseClassifyOutput(text: string): ClassifyOutput {
  const record = parseJsonObject(text);
  const category = record.category;
  if (typeof category !== "string" || !isCommentCategory(category)) {
    throw new GeminiSchemaError(
      `category 값이 정해진 다섯 종류 중 하나가 아닙니다: ${JSON.stringify(category)}`,
    );
  }
  const mixedSignals = record.mixedSignals;
  if (typeof mixedSignals !== "boolean") {
    throw new GeminiSchemaError(
      `mixedSignals 값이 boolean이 아닙니다: ${JSON.stringify(mixedSignals)}`,
    );
  }
  return { category, mixedSignals };
}

export function parseDraftOutput(text: string): DraftOutput {
  const record = parseJsonObject(text);
  const draft = record.draft;
  if (typeof draft !== "string" || draft.trim().length === 0) {
    throw new GeminiSchemaError(
      `draft 값이 비어 있지 않은 문자열이 아닙니다: ${JSON.stringify(draft)}`,
    );
  }
  return { draft };
}

export function parseContextCheckOutput(text: string): ContextCheckOutput {
  const record = parseJsonObject(text);
  const passed = record.passed;
  if (typeof passed !== "boolean") {
    throw new GeminiSchemaError(
      `passed 값이 boolean이 아닙니다: ${JSON.stringify(passed)}`,
    );
  }
  const reason = record.reason;
  if (reason !== undefined && typeof reason !== "string") {
    throw new GeminiSchemaError(`reason 값이 문자열이 아닙니다: ${JSON.stringify(reason)}`);
  }
  // passed === true is the only value that means "passed" — false is a
  // legitimate negative result, but anything that was not a real boolean
  // already threw above, so this line can never silently upgrade a failure.
  return { passed: passed === true, reason: typeof reason === "string" ? reason : "" };
}
