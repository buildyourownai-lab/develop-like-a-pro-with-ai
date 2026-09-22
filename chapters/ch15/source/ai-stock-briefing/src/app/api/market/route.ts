import { NextResponse } from "next/server";
import { getMarketOverview } from "@/lib/market";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const overview = await getMarketOverview();
    return NextResponse.json(overview);
  } catch {
    return NextResponse.json(
      { error: "시장 정보를 가져오지 못했습니다." },
      { status: 502 }
    );
  }
}
