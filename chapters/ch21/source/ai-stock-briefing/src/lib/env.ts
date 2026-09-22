import "server-only";

/**
 * 금융위원회 인증키는 서버에서만 읽는다.
 * "server-only"를 붙여 두면 브라우저로 가는 코드가 이 파일을 가져오는 순간 build가 실패한다.
 */
export function readServiceKey(): string {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY?.trim();
  if (!serviceKey) {
    throw new Error("서버에 금융위원회 인증키(DATA_GO_KR_SERVICE_KEY)가 준비되지 않았습니다.");
  }
  return serviceKey;
}

/** OpenDART 인증키도 같은 규칙으로 서버에서만 읽는다. */
export function readDartKey(): string {
  const dartKey = process.env.OPEN_DART_API_KEY?.trim();
  if (!dartKey) {
    throw new Error("서버에 OpenDART 인증키(OPEN_DART_API_KEY)가 준비되지 않았습니다.");
  }
  return dartKey;
}

/** Gemini API Key도 브라우저 번들에 들어가지 않는 서버 환경변수로만 읽는다. */
export function readGeminiKey(): string {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) {
    throw new Error("서버에 Gemini API Key(GEMINI_API_KEY)가 준비되지 않았습니다.");
  }
  return geminiKey;
}

/** 검증한 stable 모델을 기본값으로 두되 출간 전 재검증을 위해 환경변수로 교체할 수 있다. */
export function readGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash-lite";
}
