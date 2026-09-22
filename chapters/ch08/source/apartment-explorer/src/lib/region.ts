import { coordToRegionCode, searchAddress, type KakaoRegionCode } from "./kakao";

export type RegionResolution =
  | {
      status: "resolved";
      /** 국토교통부 실거래가 조회에 쓰는 법정동코드 앞 5자리(시군구코드) */
      lawdCd: string;
      /** 실거래가 응답의 umdNm과 대응하는 법정동 이름 */
      legalDongName: string;
      sido: string;
      sigungu: string;
      displayName: string;
    }
  | { status: "not_found"; message: string }
  | { status: "ambiguous"; message: string; candidates: string[] };

/**
 * 법정동/행정동 이름, 도로명주소 등 사용자가 입력한 어떤 형태의 지역 표기든
 * Kakao 주소 검색 + 좌표→행정구역 API로만 법정동을 확정한다.
 * 동 이름 문자열을 잘라내거나 비슷한 지역으로 추측하지 않는다.
 */
export async function resolveRegion(query: string): Promise<RegionResolution> {
  const addresses = await searchAddress(query);
  if (addresses.length === 0) {
    return {
      status: "not_found",
      message: `"${query}"에 해당하는 주소를 찾을 수 없습니다. 더 정확한 주소를 입력해 주세요.`,
    };
  }

  const regionLookups = await Promise.all(
    addresses.map((address) => coordToRegionCode(address.coords)),
  );
  const legalRegions = regionLookups
    .map((codes) => codes.find((c) => c.regionType === "B"))
    .filter((c): c is KakaoRegionCode => c !== undefined);

  if (legalRegions.length === 0) {
    return {
      status: "not_found",
      message: `"${query}"의 법정동 정보를 확인할 수 없습니다. 더 정확한 주소를 입력해 주세요.`,
    };
  }

  const uniqueByDong = new Map<string, KakaoRegionCode>();
  for (const region of legalRegions) {
    uniqueByDong.set(`${region.sido}|${region.sigungu}|${region.dongName}`, region);
  }

  if (uniqueByDong.size > 1) {
    const candidates = [...uniqueByDong.values()].map((r) => `${r.sido} ${r.sigungu} ${r.dongName}`);
    return {
      status: "ambiguous",
      message: `"${query}"가 여러 지역으로 해석되어 하나로 정할 수 없습니다. 더 정확한 주소를 입력해 주세요.`,
      candidates,
    };
  }

  const region = [...uniqueByDong.values()][0];
  return {
    status: "resolved",
    lawdCd: region.code.slice(0, 5),
    legalDongName: region.dongName,
    sido: region.sido,
    sigungu: region.sigungu,
    displayName: `${region.sido} ${region.sigungu} ${region.dongName}`,
  };
}
