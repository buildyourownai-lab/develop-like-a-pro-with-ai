import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseAddressResponse, parsePlacesResponse } from "./kakao";

function fixtureJson(name: string): unknown {
  const url = new URL(`./__fixtures__/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf-8"));
}

describe("parseAddressResponse", () => {
  it("주소 검색 응답에서 좌표와 도로명주소를 추출한다", () => {
    const results = parseAddressResponse(fixtureJson("kakao-address-response.json") as never);

    expect(results).toHaveLength(1);
    expect(results[0].coords).toEqual({ lng: 127.055, lat: 37.5 });
    expect(results[0].roadAddressName).toBe("서울 강남구 테스트로 10");
  });
});

describe("parsePlacesResponse", () => {
  it("주변 지하철역 목록을 거리순으로 파싱한다", () => {
    const stations = parsePlacesResponse(fixtureJson("kakao-category-subway-response.json") as never);

    expect(stations).toHaveLength(2);
    expect(stations[0]).toMatchObject({ name: "테스트역", distanceMeters: 320 });
    expect(stations[1]).toMatchObject({ name: "샘플역", distanceMeters: 890 });
    expect(stations.every((s) => s.categoryName.includes("지하철"))).toBe(true);
  });

  it("주변 초등학교 목록을 파싱한다", () => {
    const schools = parsePlacesResponse(fixtureJson("kakao-keyword-school-response.json") as never);

    expect(schools).toHaveLength(2);
    expect(schools.map((s) => s.name)).toEqual(["테스트초등학교", "샘플초등학교"]);
    expect(schools.every((s) => s.categoryName.includes("초등학교"))).toBe(true);
  });
});
