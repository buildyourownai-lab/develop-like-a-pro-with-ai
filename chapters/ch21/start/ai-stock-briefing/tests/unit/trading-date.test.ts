import assert from "node:assert/strict";
import { test } from "node:test";

import {
  daysBehindToday,
  formatBaseDate,
  formatMonthLabel,
  formatShortDate,
  seoulToday,
  shiftDays,
  shiftYears,
} from "../../src/lib/trading-date";

test("서버 시간대와 무관하게 한국 날짜를 쓴다", () => {
  // 한국시간 2026-08-19 08:30 = UTC 2026-08-18 23:30
  assert.equal(seoulToday(new Date("2026-08-18T23:30:00Z")), "20260819");
  assert.equal(seoulToday(new Date("2026-08-18T14:00:00Z")), "20260818");
});

test("날짜를 앞뒤로 옮긴다", () => {
  assert.equal(shiftDays("20260818", 1), "20260819");
  assert.equal(shiftDays("20260101", -1), "20251231");
  assert.equal(shiftDays("20260228", 1), "20260301", "2026년은 윤년이 아니다");
  assert.equal(shiftYears("20260818", -1), "20250818");
});

test("기준일을 요일까지 함께 보여 준다", () => {
  assert.equal(formatBaseDate("20260818"), "2026.08.18 (화)");
  assert.equal(formatBaseDate("20260814"), "2026.08.14 (금)");
  assert.equal(formatShortDate("20260818"), "2026.08.18");
  assert.equal(formatMonthLabel("20260818"), "26.08");
});

test("기준일이 며칠 전인지 센다", () => {
  const now = new Date("2026-08-19T05:00:00Z");
  assert.equal(daysBehindToday("20260819", now), 0);
  assert.equal(daysBehindToday("20260818", now), 1);
  assert.equal(daysBehindToday("20260814", now), 5);
});
