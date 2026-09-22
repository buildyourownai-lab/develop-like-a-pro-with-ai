// 오류 메시지나 로그에 인증키·연결 문자열 같은 값이 그대로 섞여 나가는 것을
// 막는 마지막 방어선이다. 정상 경로에서는 애초에 값을 로그로 남기지 않지만,
// 예외 메시지에 우연히 값이 포함되는 경우까지 대비한다.
export function redactSecret(text: string, secret: string | undefined): string {
  return secret ? text.split(secret).join("[REDACTED]") : text;
}
