import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KakaoApiError, parseAddressResponse, parsePlacesResponse, searchAddress } from "./kakao";

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

describe("searchAddress", () => {
  it("KAKAO_REST_API_KEY가 없으면 KakaoApiError를 던진다", async () => {
    const original = process.env.KAKAO_REST_API_KEY;
    delete process.env.KAKAO_REST_API_KEY;

    await expect(searchAddress("서울 강남구")).rejects.toBeInstanceOf(KakaoApiError);

    if (original === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = original;
  });

  it("응답이 오지 않으면 다시 시도한 뒤 KakaoApiError로 원인을 밝힌다", async () => {
    const original = { key: process.env.KAKAO_REST_API_KEY, fetch: globalThis.fetch };
    process.env.KAKAO_REST_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      const error = new TypeError("fetch failed");
      error.cause = Object.assign(new Error("The operation was aborted due to timeout"), {
        code: "UND_ERR_CONNECT_TIMEOUT",
      });
      throw error;
    }) as typeof globalThis.fetch;

    const error = await searchAddress("서울 강남구 대치동").catch((caught) => caught);

    expect(error).toBeInstanceOf(KakaoApiError);
    expect((error as KakaoApiError).message).toContain("UND_ERR_CONNECT_TIMEOUT");
    expect(calls).toBe(3);

    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = original.key;
  }, 20_000);

  it("한 번 끊겨도 다음 시도에서 응답이 오면 주소를 돌려준다", async () => {
    const original = { key: process.env.KAKAO_REST_API_KEY, fetch: globalThis.fetch };
    process.env.KAKAO_REST_API_KEY = "test-key";
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(JSON.stringify(fixtureJson("kakao-address-response.json")), {
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const results = await searchAddress("서울 강남구 대치동");

    expect(results).toHaveLength(1);
    expect(calls).toBe(2);

    globalThis.fetch = original.fetch;
    if (original.key === undefined) delete process.env.KAKAO_REST_API_KEY;
    else process.env.KAKAO_REST_API_KEY = original.key;
  });
});
