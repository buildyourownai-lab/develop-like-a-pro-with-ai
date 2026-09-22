import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const { fetchFscPage } = vi.hoisted(() => ({ fetchFscPage: vi.fn() }));
vi.mock("@/lib/fsc-api", () => ({ fetchFscPage }));

import { getStockHistorySnapshot } from "@/lib/stock-price-api";

function row(code: string, basDt: string, close: string) {
  return {
    basDt, srtnCd: code, isinCd: `KR${code}`, itmsNm: "검증종목", mrktCtg: "KOSPI",
    clpr: close, vs: "1", fltRt: "0.1", mkp: close, hipr: close, lopr: close,
    trqu: "10", trPrc: "100", lstgStCnt: "1000", mrktTotAmt: "10000",
  };
}

afterEach(() => {
  vi.useRealTimers();
  fetchFscPage.mockReset();
});

describe("종목 기간 벌크 조회", () => {
  it("한 번의 기간 요청에서 정확한 종목 최신행과 최근 1년 bars를 만든다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00+09:00"));
    fetchFscPage.mockResolvedValue({
      totalCount: 5,
      items: [
        row("000660", "20250902", "100"),
        row("005930", "20260903", "999"),
        row("000660", "20260901", "300"),
        row("000660", "20250903", "200"),
        row("000660", "20260903", "400"),
      ],
    });

    const result = await getStockHistorySnapshot("000660");

    expect(fetchFscPage).toHaveBeenCalledTimes(1);
    expect(fetchFscPage).toHaveBeenCalledWith(
      expect.stringContaining("getStockPriceInfo"),
      {
        numOfRows: 400,
        pageNo: 1,
        likeSrtnCd: "000660",
        beginBasDt: "20250822",
        endBasDt: "20260907",
      },
      "금융위원회 주식시세정보"
    );
    expect(result?.basDt).toBe("20260903");
    expect(result?.item.clpr).toBe("400");
    expect(result?.yearly.requestedBeginBasDt).toBe("20250903");
    expect(result?.yearly.bars.map((bar) => [bar.basDt, bar.close])).toEqual([
      ["20250903", 200],
      ["20260901", 300],
      ["20260903", 400],
    ]);
  });

  it("정확한 종목 행이 없으면 null을 반환한다", async () => {
    fetchFscPage.mockResolvedValue({ totalCount: 1, items: [row("005930", "20260903", "999")] });
    await expect(getStockHistorySnapshot("000660")).resolves.toBeNull();
    expect(fetchFscPage).toHaveBeenCalledTimes(1);
  });
});

describe("상세·브리핑 호출 경로", () => {
  it("구형 날짜별 조회 대신 기간 snapshot을 사용한다", () => {
    for (const file of [
      "src/app/stocks/[code]/page.tsx",
      "src/app/stocks/[code]/briefing-actions.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toContain("getStockHistorySnapshot");
      expect(source).not.toContain("getLatestStockPriceByCode");
      expect(source).not.toContain("getYearlyDailyPrices");
    }
  });
});
