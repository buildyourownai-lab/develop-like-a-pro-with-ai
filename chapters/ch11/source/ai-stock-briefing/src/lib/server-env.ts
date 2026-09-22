import "server-only";

export function getDataGoKrServiceKey(): string {
  const key = process.env.DATA_GO_KR_SERVICE_KEY;
  if (!key) {
    throw new Error(
      "DATA_GO_KR_SERVICE_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}

export function getOpenDartApiKey(): string {
  const key = process.env.OPEN_DART_API_KEY;
  if (!key) {
    throw new Error(
      "OPEN_DART_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}

export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GEMINI_API_KEY가 설정되지 않았습니다. .env.local을 확인하세요."
    );
  }
  return key;
}
