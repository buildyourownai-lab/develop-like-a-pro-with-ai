const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// Host 헤더는 클라이언트가 보내는 값이라 신뢰할 수 없지만, 이 화면은 개발자
// 본인이 브라우저 주소창에 직접 입력한 주소로만 여는 로컬 전용 화면이므로
// localhost/127.0.0.1로 접속했는지 확인하는 정도로 충분하다.
export function isLocalHostname(hostHeader: string | null): boolean {
  if (!hostHeader) return false;

  const withoutPort = hostHeader.startsWith("[")
    ? hostHeader.slice(1, hostHeader.indexOf("]"))
    : hostHeader.split(":")[0];

  return LOCAL_HOSTNAMES.has(withoutPort);
}
