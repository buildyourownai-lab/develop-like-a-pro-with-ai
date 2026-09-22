import { NextRequest, NextResponse } from "next/server";
import { searchListedStocks } from "@/lib/krx-listed-info-api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json(
      { error: "검색어(q)가 필요합니다." },
      { status: 400 }
    );
  }

  try {
    const results = await searchListedStocks(query);
    return NextResponse.json({ query, results });
  } catch {
    return NextResponse.json(
      { error: "종목 검색에 실패했습니다." },
      { status: 502 }
    );
  }
}
