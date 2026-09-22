export type GeminiErrorKind =
  | "quota"
  | "authentication"
  | "model"
  | "timeout"
  | "call"
  | "response_format";

function errorField(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

/** SDK 예외의 공개 가능한 속성만 읽어 사용자에게 보여 줄 오류 종류를 결정한다. */
export function classifyGeminiCallError(caught: unknown): Exclude<GeminiErrorKind, "response_format"> {
  const status = Number(errorField(caught, "status") ?? errorField(caught, "statusCode"));
  const name = String(errorField(caught, "name") ?? "");
  const message = String(errorField(caught, "message") ?? "");

  if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate.?limit/i.test(message)) return "quota";
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "model";
  if (name === "AbortError" || /timed?\s*out|timeout/i.test(message)) return "timeout";
  return "call";
}
