import { describe, it, expect, vi } from "vitest";
import { searchListedStocks } from "@/lib/krx-listed-info-api";

describe("종목명과 실제 영숫자 종목코드를 구분한다", () => {
  it.each([
    ["0220W0", "likeSrtnCd"], ["0044K0", "likeSrtnCd"],
    ["005930", "likeSrtnCd"], ["005", "likeSrtnCd"],
    ["삼성전자", "likeItmsNm"], ["NAVER", "likeItmsNm"],
  ])("%s를 공식 검색 인자 %s로 전달한다", async (query, parameter) => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "offline-fsc-key");
    vi.stubEnv("SUPABASE_DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    const urls: URL[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      urls.push(url);
      return Response.json({ response: { header: { resultCode: "00" }, body: {
        totalCount: 1, items: { item: [{ basDt: "20261116", srtnCd: "A0044K0",
          isinCd: "KR7000000001", itmsNm: "검색 분기 시험", mrktCtg: "KOSDAQ", corpNm: "회사" }] },
      } } });
    }));
    try {
      const results = await searchListedStocks(query);
      const provider = urls.find(url => url.searchParams.has("likeSrtnCd") || url.searchParams.has("likeItmsNm"));
      expect(provider?.pathname).toBe("/1160100/service/GetKrxListedInfoService/getItemInfo");
      expect(provider?.searchParams.get(parameter)).toBe(query);
      expect(provider?.searchParams.has(parameter === "likeSrtnCd" ? "likeItmsNm" : "likeSrtnCd")).toBe(false);
      expect(results[0].code).toBe("0044K0");
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
