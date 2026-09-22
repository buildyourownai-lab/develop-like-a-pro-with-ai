import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveRegion } from "./region";
import * as kakao from "./kakao";

vi.mock("./kakao", () => ({
  searchAddress: vi.fn(),
  coordToRegionCode: vi.fn(),
}));

describe("resolveRegion", () => {
  beforeEach(() => {
    vi.mocked(kakao.searchAddress).mockReset();
    vi.mocked(kakao.coordToRegionCode).mockReset();
  });

  it("법정동 이름을 입력하면 법정동코드로 해석한다", async () => {
    vi.mocked(kakao.searchAddress).mockResolvedValue([
      { addressName: "서울 강남구 대치동", coords: { lng: 127.05, lat: 37.5 } },
    ]);
    vi.mocked(kakao.coordToRegionCode).mockResolvedValue([
      { regionType: "B", sido: "서울특별시", sigungu: "강남구", dongName: "대치동", code: "1168010600" },
      { regionType: "H", sido: "서울특별시", sigungu: "강남구", dongName: "대치4동", code: "1168066000" },
    ]);

    const result = await resolveRegion("서울 강남구 대치동");
    expect(result).toMatchObject({ status: "resolved", lawdCd: "11680", legalDongName: "대치동" });
  });

  it("행정동 이름을 입력해도 그 동 이름을 문자열로 손대지 않고 법정동코드로 해석한다", async () => {
    vi.mocked(kakao.searchAddress).mockResolvedValue([
      { addressName: "서울 송파구 잠실2동", coords: { lng: 127.08, lat: 37.51 } },
    ]);
    vi.mocked(kakao.coordToRegionCode).mockResolvedValue([
      { regionType: "B", sido: "서울특별시", sigungu: "송파구", dongName: "잠실동", code: "1171010700" },
      { regionType: "H", sido: "서울특별시", sigungu: "송파구", dongName: "잠실2동", code: "1171063000" },
    ]);

    const result = await resolveRegion("서울 송파구 잠실2동");
    expect(result).toMatchObject({ status: "resolved", lawdCd: "11710", legalDongName: "잠실동" });
  });

  it("주소 검색 결과가 없으면 not_found를 반환한다", async () => {
    vi.mocked(kakao.searchAddress).mockResolvedValue([]);

    const result = await resolveRegion("존재하지않는주소12345");
    expect(result.status).toBe("not_found");
  });

  it("서로 다른 동을 가리키는 결과가 섞여 있으면 임의로 하나를 고르지 않고 ambiguous를 반환한다", async () => {
    vi.mocked(kakao.searchAddress).mockResolvedValue([
      { addressName: "a", coords: { lng: 1, lat: 1 } },
      { addressName: "b", coords: { lng: 2, lat: 2 } },
    ]);
    vi.mocked(kakao.coordToRegionCode)
      .mockResolvedValueOnce([
        { regionType: "B", sido: "서울특별시", sigungu: "강남구", dongName: "대치동", code: "1168010600" },
      ])
      .mockResolvedValueOnce([
        { regionType: "B", sido: "서울특별시", sigungu: "송파구", dongName: "잠실동", code: "1171010700" },
      ]);

    const result = await resolveRegion("모호한 지역");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("같은 동을 가리키는 여러 지번 후보는 모호한 것으로 보지 않는다", async () => {
    vi.mocked(kakao.searchAddress).mockResolvedValue([
      { addressName: "서울 강남구 대치동 1", coords: { lng: 1, lat: 1 } },
      { addressName: "서울 강남구 대치동 2", coords: { lng: 1.001, lat: 1.001 } },
    ]);
    vi.mocked(kakao.coordToRegionCode).mockResolvedValue([
      { regionType: "B", sido: "서울특별시", sigungu: "강남구", dongName: "대치동", code: "1168010600" },
    ]);

    const result = await resolveRegion("서울 강남구 대치동");
    expect(result.status).toBe("resolved");
  });
});
