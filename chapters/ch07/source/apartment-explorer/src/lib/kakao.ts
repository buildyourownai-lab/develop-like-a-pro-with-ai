const BASE_URL = "https://dapi.kakao.com";

export interface KakaoCoords {
  lng: number;
  lat: number;
}

export interface KakaoAddressResult {
  addressName: string;
  roadAddressName?: string;
  coords: KakaoCoords;
}

export interface KakaoPlace {
  name: string;
  categoryName: string;
  address: string;
  distanceMeters: number;
}

function authHeaders(): HeadersInit {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) {
    throw new Error("KAKAO_REST_API_KEY가 설정되어 있지 않습니다 (.env.local 확인).");
  }
  return { Authorization: `KakaoAK ${key}` };
}

function redactKey(text: string): string {
  const key = process.env.KAKAO_REST_API_KEY;
  return key ? text.split(key).join("[REDACTED]") : text;
}

async function getJson(url: URL) {
  const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`Kakao Local API 오류 (${res.status}): ${redactKey(JSON.stringify(body))}`);
  }
  return body;
}

interface KakaoAddressDocument {
  address_name: string;
  x: string;
  y: string;
  road_address: { address_name: string } | null;
}

/** 주소 검색 API 응답 바디를 결과 목록으로 변환한다. 네트워크 호출 없이 단독으로 테스트 가능. */
export function parseAddressResponse(body: { documents?: KakaoAddressDocument[] }): KakaoAddressResult[] {
  return (body.documents ?? []).map((d) => ({
    addressName: d.address_name,
    roadAddressName: d.road_address?.address_name,
    coords: { lng: Number(d.x), lat: Number(d.y) },
  }));
}

export async function searchAddress(query: string): Promise<KakaoAddressResult[]> {
  const url = new URL(`${BASE_URL}/v2/local/search/address.json`);
  url.searchParams.set("query", query);
  const body = await getJson(url);
  return parseAddressResponse(body);
}

export async function searchNearbyByCategory(
  coords: KakaoCoords,
  categoryGroupCode: string,
  radiusMeters = 1000,
  size = 5,
): Promise<KakaoPlace[]> {
  const url = new URL(`${BASE_URL}/v2/local/search/category.json`);
  url.searchParams.set("category_group_code", categoryGroupCode);
  url.searchParams.set("x", String(coords.lng));
  url.searchParams.set("y", String(coords.lat));
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", String(size));
  const body = await getJson(url);
  return parsePlacesResponse(body);
}

export async function searchNearbyByKeyword(
  coords: KakaoCoords,
  keyword: string,
  radiusMeters = 1000,
  size = 5,
): Promise<KakaoPlace[]> {
  const url = new URL(`${BASE_URL}/v2/local/search/keyword.json`);
  url.searchParams.set("query", keyword);
  url.searchParams.set("x", String(coords.lng));
  url.searchParams.set("y", String(coords.lat));
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("sort", "distance");
  url.searchParams.set("size", String(size));
  const body = await getJson(url);
  return parsePlacesResponse(body);
}

/** 카테고리/키워드 장소 검색 API 응답 바디를 결과 목록으로 변환한다. 네트워크 호출 없이 단독으로 테스트 가능. */
export function parsePlacesResponse(body: { documents?: Record<string, string>[] }): KakaoPlace[] {
  return (body.documents ?? []).map((d) => ({
    name: d.place_name,
    categoryName: d.category_name,
    address: d.road_address_name || d.address_name,
    distanceMeters: Number(d.distance) || 0,
  }));
}

export interface KakaoRegionCode {
  /** "B" = 법정동, "H" = 행정동 */
  regionType: "B" | "H";
  sido: string;
  sigungu: string;
  /** 법정동/행정동 이름 (B 기준으로는 국토교통부 실거래가의 umdNm과 대응) */
  dongName: string;
  /** 10자리 법정동코드/행정동코드 */
  code: string;
}

/** 좌표→행정구역 API 응답 바디를 결과 목록으로 변환한다. 네트워크 호출 없이 단독으로 테스트 가능. */
export function parseRegionCodeResponse(body: { documents?: Record<string, string>[] }): KakaoRegionCode[] {
  return (body.documents ?? []).map((d) => ({
    regionType: d.region_type as "B" | "H",
    sido: d.region_1depth_name,
    sigungu: d.region_2depth_name,
    dongName: d.region_3depth_name,
    code: d.code,
  }));
}

/** 좌표를 법정동/행정동 정보로 변환한다. 동 이름을 문자열로 추측하지 않고 이 API로 확정한다. */
export async function coordToRegionCode(coords: KakaoCoords): Promise<KakaoRegionCode[]> {
  const url = new URL(`${BASE_URL}/v2/local/geo/coord2regioncode.json`);
  url.searchParams.set("x", String(coords.lng));
  url.searchParams.set("y", String(coords.lat));
  const body = await getJson(url);
  return parseRegionCodeResponse(body);
}
