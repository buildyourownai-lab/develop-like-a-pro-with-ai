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
