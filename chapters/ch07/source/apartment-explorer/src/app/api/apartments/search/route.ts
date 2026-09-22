import { NextRequest, NextResponse } from "next/server";
import { searchApartments } from "@/lib/apartmentSearch";

function requireNumber(searchParams: URLSearchParams, key: string): number | null {
  const raw = searchParams.get(key);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const region = searchParams.get("region");

  const minAreaSqm = requireNumber(searchParams, "minAreaSqm");
  const maxAreaSqm = requireNumber(searchParams, "maxAreaSqm");
  const minPriceManwon = requireNumber(searchParams, "minPriceManwon");
  const maxPriceManwon = requireNumber(searchParams, "maxPriceManwon");
  const maxSubwayDistanceMeters = requireNumber(searchParams, "maxSubwayDistanceMeters");
  const maxSchoolDistanceMeters = requireNumber(searchParams, "maxSchoolDistanceMeters");

  if (
    !region ||
    minAreaSqm === null ||
    maxAreaSqm === null ||
    minPriceManwon === null ||
    maxPriceManwon === null ||
    maxSubwayDistanceMeters === null ||
    maxSchoolDistanceMeters === null
  ) {
    return NextResponse.json(
      {
        status: "invalid_range",
        message:
          "region, minAreaSqm, maxAreaSqm, minPriceManwon, maxPriceManwon, maxSubwayDistanceMeters, maxSchoolDistanceMeters를 모두 입력해야 합니다.",
      },
      { status: 400 },
    );
  }

  const outcome = await searchApartments({
    region,
    minAreaSqm,
    maxAreaSqm,
    minPriceManwon,
    maxPriceManwon,
    maxSubwayDistanceMeters,
    maxSchoolDistanceMeters,
  });

  return NextResponse.json(outcome);
}
