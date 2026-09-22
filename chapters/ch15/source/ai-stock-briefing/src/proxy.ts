import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isLocalHostname } from "@/lib/local-request";

// Secret 입력 화면은 이 컴퓨터에서 localhost/127.0.0.1로 열었을 때만 접근할 수
// 있게 막는다. 같은 네트워크의 다른 장비가 이 서버의 LAN 주소로 접속해도
// 이 화면은 보이지 않는다.
export function proxy(request: NextRequest) {
  if (!isLocalHostname(request.headers.get("host"))) {
    return new NextResponse("Not Found", { status: 404 });
  }
}

export const config = {
  matcher: "/setup/:path*",
};
