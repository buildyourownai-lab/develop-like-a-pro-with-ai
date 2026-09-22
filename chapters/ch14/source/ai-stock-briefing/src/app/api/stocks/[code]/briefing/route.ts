import { NextResponse } from "next/server";
import { generateStockBriefingAction } from "@/app/stocks/[code]/briefing-actions";

// 클라이언트가 눌렀을 때만 호출되어야 한다 — GET이 아니라 POST로만 연다.
// 기존 Server Action을 그대로 호출하므로 사실 계산·이중 검증·캐시·Gemini
// 사용량 한도 로직을 API 쪽에서 다시 만들지 않는다.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  try {
    const result = await generateStockBriefingAction(code);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      { error: "브리핑을 만드는 중 문제가 발생했습니다." },
      { status: 502 }
    );
  }
}
