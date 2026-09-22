import { NextResponse } from "next/server";
import {
  getDisclosurePageByStockCode,
  getDisclosureTypeCounts,
  isDisclosureTypeCode,
} from "@/lib/dart-disclosure-api";
import { formatYyyyMmDd, subtractDaysYyyyMmDd } from "@/lib/trading-date";

export const dynamic = "force-dynamic";

// 전체 공시 화면(src/app/stocks/[code]/disclosures/page.tsx)과 같은
// 페이지네이션(100건)·유형 필터·조회 기간(최근 1년)을 쓴다.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const url = new URL(request.url);
  const pageNo = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const typeParam = url.searchParams.get("type");
  const disclosureType =
    typeParam && isDisclosureTypeCode(typeParam) ? typeParam : undefined;

  const endDate = formatYyyyMmDd(new Date());
  const beginDate = subtractDaysYyyyMmDd(endDate, 365);

  try {
    const [page, typeCounts] = await Promise.all([
      getDisclosurePageByStockCode(code, beginDate, endDate, pageNo, {
        disclosureType,
      }),
      getDisclosureTypeCounts(code, beginDate, endDate),
    ]);
    return NextResponse.json({ page, typeCounts });
  } catch {
    return NextResponse.json(
      { error: "공시 목록을 가져오지 못했습니다." },
      { status: 502 }
    );
  }
}
