import { NextRequest, NextResponse } from "next/server";
import { fetchAptTrades, formatAptTrade } from "@/lib/molit";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const lawdCd = searchParams.get("lawdCd") ?? "11680";
  const dealYmd = searchParams.get("dealYmd") ?? "202606";
  const numOfRows = Number(searchParams.get("numOfRows") ?? "5");

  try {
    const records = await fetchAptTrades({ lawdCd, dealYmd, numOfRows });
    return NextResponse.json({
      ok: true,
      lawdCd,
      dealYmd,
      count: records.length,
      summaries: records.map(formatAptTrade),
      records,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
