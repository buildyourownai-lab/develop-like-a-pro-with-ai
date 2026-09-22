import { describe, it, expect } from "vitest";
import {
  subtractDaysYyyyMmDd,
  findLatestTradingDate,
} from "../src/lib/trading-date";

describe("subtractDaysYyyyMmDd", () => {
  it("월을 넘어가는 날짜를 올바르게 계산한다", () => {
    expect(subtractDaysYyyyMmDd("20260301", 2)).toBe("20260227");
  });

  it("연도를 넘어가는 날짜를 올바르게 계산한다", () => {
    expect(subtractDaysYyyyMmDd("20260101", 1)).toBe("20251231");
  });
});

describe("findLatestTradingDate", () => {
  it("오늘 데이터가 있으면 오늘을 그대로 돌려준다", async () => {
    const result = await findLatestTradingDate(
      async () => 2875,
      "20260827"
    );
    expect(result).toBe("20260827");
  });

  it("주말처럼 며칠 연속 0건이어도 데이터가 있는 날짜까지 거슬러 올라간다", async () => {
    // 20260830(일)=0, 20260829(토)=0, 20260828(금)=0, 20260827(목)=2875
    const totalCountByDate: Record<string, number> = {
      "20260830": 0,
      "20260829": 0,
      "20260828": 0,
      "20260827": 2875,
    };
    const result = await findLatestTradingDate(
      async (basDt) => totalCountByDate[basDt] ?? 0,
      "20260830"
    );
    expect(result).toBe("20260827");
  });

  it("탐색 범위 안에 데이터가 없으면 오류를 던진다", async () => {
    await expect(
      findLatestTradingDate(async () => 0, "20260830", 3)
    ).rejects.toThrow();
  });
});
