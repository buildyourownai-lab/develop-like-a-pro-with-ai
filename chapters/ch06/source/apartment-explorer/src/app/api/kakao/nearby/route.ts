import { NextRequest, NextResponse } from "next/server";
import { searchAddress, searchNearbyByCategory, searchNearbyByKeyword } from "@/lib/kakao";

const SUBWAY_STATION_CATEGORY = "SW8";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const address = searchParams.get("address") ?? "서울특별시 송파구 위례성대로 32";
  const radius = Number(searchParams.get("radius") ?? "1000");

  try {
    const addresses = await searchAddress(address);
    if (addresses.length === 0) {
      return NextResponse.json({ ok: false, error: "주소 검색 결과가 없습니다." }, { status: 404 });
    }
    const resolved = addresses[0];

    const [subwayStations, elementarySchools] = await Promise.all([
      searchNearbyByCategory(resolved.coords, SUBWAY_STATION_CATEGORY, radius, 5),
      searchNearbyByKeyword(resolved.coords, "초등학교", radius, 5),
    ]);

    return NextResponse.json({
      ok: true,
      query: address,
      resolved,
      subwayStations,
      elementarySchools,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
