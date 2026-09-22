import { describe, expect, it, vi, beforeEach } from "vitest";
import { searchApartments, type ApartmentSearchCriteria } from "./apartmentSearch";
import * as molit from "./molit";
import * as kakao from "./kakao";
import * as regionLib from "./region";
import { MolitApiError } from "./molit";
import { KakaoApiError } from "./kakao";
import type { AptTradeRecord } from "./molit";

vi.mock("./molit", async () => {
  const actual = await vi.importActual<typeof import("./molit")>("./molit");
  return { ...actual, fetchAptTrades: vi.fn() };
});
vi.mock("./kakao", async () => {
  const actual = await vi.importActual<typeof import("./kakao")>("./kakao");
  return {
    ...actual,
    searchAddress: vi.fn(),
    searchNearbyByCategory: vi.fn(),
    searchNearbyByKeyword: vi.fn(),
  };
});
vi.mock("./region", () => ({ resolveRegion: vi.fn() }));

const NOW = new Date("2026-08-30T00:00:00.000Z");

const RESOLVED_DAECHI = {
  status: "resolved" as const,
  lawdCd: "11680",
  legalDongName: "대치동",
  sido: "서울특별시",
  sigungu: "강남구",
  displayName: "서울특별시 강남구 대치동",
};

const BASE_CRITERIA: ApartmentSearchCriteria = {
  region: "서울 강남구 대치동",
  minAreaSqm: 80,
  maxAreaSqm: 90,
  minPriceManwon: 200000,
  maxPriceManwon: 300000,
  maxSubwayDistanceMeters: 800,
  maxSchoolDistanceMeters: 1000,
};

function trade(overrides: Partial<AptTradeRecord>): AptTradeRecord {
  return {
    aptName: "한티아파트",
    legalDong: "대치동",
    jibun: "12-3",
    floor: 10,
    exclusiveAreaSqm: 84.5,
    buildYear: 2010,
    dealDate: "2026-06-10",
    dealAmountManwon: 250000,
    isCancelled: false,
    raw: {},
    ...overrides,
  };
}

const COORDS_BY_JIBUN: Record<string, { lng: number; lat: number }> = {
  "12-3": { lng: 127.05, lat: 37.5 },
  "5": { lng: 127.06, lat: 37.51 },
};

describe("searchApartments", () => {
  beforeEach(() => {
    vi.mocked(regionLib.resolveRegion).mockReset().mockResolvedValue(RESOLVED_DAECHI);
    vi.mocked(molit.fetchAptTrades).mockReset();
    vi.mocked(kakao.searchAddress).mockReset().mockImplementation(async (query: string) => {
      const jibun = query.trim().split(" ").pop()!;
      return [{ addressName: query, coords: COORDS_BY_JIBUN[jibun] ?? { lng: 0, lat: 0 } }];
    });
    vi.mocked(kakao.searchNearbyByCategory).mockReset().mockImplementation(async (coords) => {
      if (coords.lng === COORDS_BY_JIBUN["5"].lng) return []; // 선릉아파트 근처엔 지하철역 없음
      return [{ name: "한티역", categoryName: "지하철", address: "", distanceMeters: 450 }];
    });
    vi.mocked(kakao.searchNearbyByKeyword).mockReset().mockResolvedValue([
      { name: "대치초등학교", categoryName: "초등학교", address: "", distanceMeters: 300 },
    ]);
  });

  it("면적·가격·거리 조건을 모두 만족하는 단지만 결과에 포함한다", async () => {
    vi.mocked(molit.fetchAptTrades).mockImplementation(async ({ dealYmd }) => {
      if (dealYmd === "202606") {
        return [
          // 한티아파트: 면적 범위 거래 2건, 그 중 가격 범위 안은 1건 → 포함
          trade({ dealDate: "2026-06-10", exclusiveAreaSqm: 84.5, dealAmountManwon: 250000 }),
          trade({ dealDate: "2026-03-01", exclusiveAreaSqm: 85, dealAmountManwon: 180000 }),
          // 거래해제 건은 정상 거래에서 제외
          trade({ dealDate: "2026-06-15", exclusiveAreaSqm: 84, dealAmountManwon: 260000, isCancelled: true }),
          // 다른 법정동 거래는 제외
          trade({ aptName: "역삼타워", legalDong: "역삼동", jibun: "9", dealDate: "2026-06-01" }),
          // 은마아파트: 지정 면적 범위에 해당하는 거래가 없어 제외
          trade({ aptName: "은마아파트", jibun: "1", exclusiveAreaSqm: 59, dealAmountManwon: 250000 }),
          // 선릉아파트: 면적·가격은 맞지만 지하철역이 기준 거리 밖 → 제외
          trade({ aptName: "선릉아파트", jibun: "5", exclusiveAreaSqm: 85, dealAmountManwon: 250000 }),
        ];
      }
      return [];
    });

    const result = await searchApartments(BASE_CRITERIA, NOW);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.results).toHaveLength(1);
    const apt = result.results[0];
    expect(apt.aptName).toBe("한티아파트");
    expect(apt.tradeCountInAreaRange).toBe(2);
    expect(apt.tradeCountInPriceRange).toBe(1);
    expect(apt.priceRangeManwonInAreaRange).toEqual({ min: 180000, max: 250000 });
    expect(apt.latestTrade).toEqual({ dealAmountManwon: 250000, dealDate: "2026-06-10" });
    expect(apt.nearestSubway).toEqual({ name: "한티역", distanceMeters: 450 });
    expect(apt.nearestElementarySchool).toEqual({ name: "대치초등학교", distanceMeters: 300 });
  });

  it("실행일 기준 최근 1년보다 오래된 거래는 제외한다", async () => {
    vi.mocked(molit.fetchAptTrades).mockImplementation(async ({ dealYmd }) => {
      if (dealYmd === "202508") {
        // 기준일(2026-08-30)로부터 1년 전인 2025-08-30보다 이전 거래 → 제외되어야 함
        return [trade({ aptName: "구아파트", jibun: "7", dealDate: "2025-08-01" })];
      }
      return [];
    });

    const result = await searchApartments(BASE_CRITERIA, NOW);

    expect(result.status).toBe("no_match");
  });

  it("조건에 맞는 정상 거래가 전혀 없으면 no_match를 반환한다", async () => {
    vi.mocked(molit.fetchAptTrades).mockResolvedValue([]);

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("no_match");
  });

  it("지역을 하나로 확정할 수 없으면 검색을 진행하지 않고 region_ambiguous를 반환한다", async () => {
    vi.mocked(regionLib.resolveRegion).mockResolvedValue({
      status: "ambiguous",
      message: "여러 지역으로 해석됩니다.",
      candidates: ["서울특별시 강남구 대치동", "서울특별시 송파구 잠실동"],
    });

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("region_ambiguous");
    expect(molit.fetchAptTrades).not.toHaveBeenCalled();
  });

  it("지역 입력을 확인할 수 없으면 region_not_found를 반환한다", async () => {
    vi.mocked(regionLib.resolveRegion).mockResolvedValue({
      status: "not_found",
      message: "주소를 찾을 수 없습니다.",
    });

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("region_not_found");
  });

  it("최소값이 최대값보다 크면 지역 조회 없이 invalid_range를 반환한다", async () => {
    const result = await searchApartments({ ...BASE_CRITERIA, minAreaSqm: 100, maxAreaSqm: 90 }, NOW);
    expect(result.status).toBe("invalid_range");
    expect(regionLib.resolveRegion).not.toHaveBeenCalled();
  });

  it("외부 API 호출이 실패하면 결과 없음과 구분되는 upstream_error를 반환한다", async () => {
    vi.mocked(molit.fetchAptTrades).mockRejectedValue(new Error("MOLIT_SERVICE_KEY가 설정되어 있지 않습니다"));

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("upstream_error");
  });

  it("지역 해석 중 Kakao API 호출이 실패해도 예외를 던지지 않고 upstream_error를 반환한다", async () => {
    vi.mocked(regionLib.resolveRegion).mockRejectedValue(new Error("Kakao Local API 오류 (401)"));

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("upstream_error");
  });

  it("MOLIT API 호출이 MolitApiError로 실패하면 upstream_error의 source가 molit이다", async () => {
    vi.mocked(molit.fetchAptTrades).mockRejectedValue(new MolitApiError("MOLIT_SERVICE_KEY가 설정되어 있지 않습니다"));

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("upstream_error");
    if (result.status !== "upstream_error") return;
    expect(result.source).toBe("molit");
    expect(result.message).not.toContain("MOLIT_SERVICE_KEY");
  });

  it("Kakao API 호출이 KakaoApiError로 실패하면 upstream_error의 source가 kakao이다", async () => {
    vi.mocked(regionLib.resolveRegion).mockRejectedValue(new KakaoApiError("Kakao Local API 오류 (401)"));

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("upstream_error");
    if (result.status !== "upstream_error") return;
    expect(result.source).toBe("kakao");
    expect(result.message).not.toContain("401");
  });

  it("분류되지 않은 예외는 upstream_error의 source가 unknown이다", async () => {
    vi.mocked(regionLib.resolveRegion).mockRejectedValue(new Error("예상하지 못한 문제"));

    const result = await searchApartments(BASE_CRITERIA, NOW);
    expect(result.status).toBe("upstream_error");
    if (result.status !== "upstream_error") return;
    expect(result.source).toBe("unknown");
    expect(result.message).not.toContain("예상하지 못한 문제");
  });
});
