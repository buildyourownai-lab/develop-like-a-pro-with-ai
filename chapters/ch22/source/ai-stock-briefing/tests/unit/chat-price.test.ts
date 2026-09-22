import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chatPriceRequestedRange,
  daysInMonth,
  isChatPricePeriod,
  isCompactDate,
  subtractCalendarMonths,
  summarizeChatPriceRange,
} from "../../src/lib/chat-price";
import type { DailyBar } from "../../src/lib/types";

/** Test용 일봉 하나. 값이 필요한 항목만 지정하고 나머지는 통과하는 기본값을 쓴다. */
function bar(date: string, close: number, extra: Partial<DailyBar> = {}): DailyBar {
  return {
    date,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
    tradeValue: close * 1_000,
    ...extra,
  };
}

test("달력 개월을 거슬러 세고, 대응 날짜가 없으면 그 달 말일로 맞춘다", () => {
  assert.equal(subtractCalendarMonths("20260915", 1), "20260815");
  assert.equal(subtractCalendarMonths("20260915", 3), "20260615");
  assert.equal(subtractCalendarMonths("20260915", 12), "20250915");

  // 월말 예외: 3월 31일의 한 달 전은 2월 31일이 아니라 그 달 말일이다.
  assert.equal(subtractCalendarMonths("20260331", 1), "20260228", "2026년은 윤년이 아니다");
  assert.equal(subtractCalendarMonths("20240331", 1), "20240229", "2024년은 윤년이다");
  assert.equal(subtractCalendarMonths("20260531", 3), "20260228");
  assert.equal(subtractCalendarMonths("20260731", 1), "20260630");

  // 윤일 자체를 기준일로 잡은 경우
  assert.equal(subtractCalendarMonths("20240229", 12), "20230228");
  assert.equal(subtractCalendarMonths("20240229", 1), "20240129");

  // 해가 바뀌는 경계
  assert.equal(subtractCalendarMonths("20260115", 1), "20251215");
  assert.equal(subtractCalendarMonths("20260131", 1), "20251231");
  assert.equal(subtractCalendarMonths("20260215", 3), "20251115");
  assert.equal(subtractCalendarMonths("20260101", 12), "20250101");
});

test("윤년 규칙은 100·400년까지 따른다", () => {
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2100, 2), 28);
  assert.equal(daysInMonth(2000, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
});

test("달력에 없는 날짜와 기간 코드는 받지 않는다", () => {
  assert.equal(isCompactDate("20260914"), true);
  assert.equal(isCompactDate("20240229"), true);
  assert.equal(isCompactDate("20260229"), false);
  assert.equal(isCompactDate("20261301"), false);
  assert.equal(isCompactDate("20260900"), false);
  assert.equal(isCompactDate("2026-09-14"), false);
  assert.equal(isCompactDate(20260914), false);

  assert.equal(isChatPricePeriod("1m"), true);
  assert.equal(isChatPricePeriod("12m"), true);
  assert.equal(isChatPricePeriod("6m"), false);
  assert.equal(isChatPricePeriod("22d"), false);

  assert.deepEqual(chatPriceRequestedRange("20260914", "3m"), { from: "20260614", to: "20260914" });
});

test("요청 범위 밖 일봉은 빼고, 요청 범위와 실제 거래일 구간을 따로 돌려준다", () => {
  const bars = [
    bar("20260610", 900), // 3개월 범위(20260614~) 밖
    bar("20260615", 1_000),
    bar("20260701", 1_100, { high: 1_200, low: 950 }),
    bar("20260914", 1_200, { high: 1_250, low: 1_150 }),
  ];
  const result = summarizeChatPriceRange({ period: "3m", baseDate: "20260914", bars });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  const { summary } = result;
  assert.deepEqual(summary.requested, { from: "20260614", to: "20260914" });
  assert.deepEqual(summary.actual, { from: "20260615", to: "20260914" });
  assert.equal(summary.tradingDays, 3, "범위 밖 20260610은 세지 않는다");
  assert.equal(summary.startClose, 1_000);
  assert.equal(summary.endClose, 1_200);
  assert.equal(summary.highestHigh, 1_250);
  assert.equal(summary.lowestLow, 950);
  assert.equal(summary.closeChange, 200);
  assert.equal(summary.closeChangeRate, 20);
  assert.equal(summary.months, 3);
  assert.equal(summary.coverage.limitedBySource, false, "원본이 요청 시작일보다 앞서 있다");
  assert.equal(summary.coverage.endsBeforeRequestedTo, false);
});

test("입력 배열을 바꾸지 않고, 순서가 뒤섞여 있어도 날짜로 정렬해 계산한다", () => {
  const bars = [bar("20260901", 1_100), bar("20260814", 1_000), bar("20260914", 1_210)];
  const before = bars.map((item) => item.date);

  const result = summarizeChatPriceRange({ period: "1m", baseDate: "20260914", bars });

  assert.deepEqual(bars.map((item) => item.date), before, "입력 배열은 그대로 남는다");
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.summary.actual, { from: "20260814", to: "20260914" });
  assert.equal(result.summary.startClose, 1_000);
  assert.equal(result.summary.endClose, 1_210);
  assert.equal(result.summary.tradingDays, 3);
});

test("요청 시작·종료일 자체도 구간에 포함한다", () => {
  const result = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260914",
    bars: [bar("20260813", 900), bar("20260814", 1_000), bar("20260914", 1_100)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.tradingDays, 2, "경계 20260814는 포함, 그 전날은 제외");
  assert.deepEqual(result.summary.actual, { from: "20260814", to: "20260914" });
});

test("기준일에 거래일이 없으면 실제 마지막 거래일이 요청 종료일보다 이르다고 표시한다", () => {
  const result = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260913",
    bars: [bar("20260814", 1_000), bar("20260911", 1_050)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.summary.requested, { from: "20260813", to: "20260913" });
  assert.deepEqual(result.summary.actual, { from: "20260814", to: "20260911" });
  assert.equal(result.summary.coverage.endsBeforeRequestedTo, true);
});

test("원본이 요청 시작일보다 늦게 시작하면 자료 한계를 밝히고, 그 자체를 계산 실패로 보지 않는다", () => {
  const bars = [bar("20260401", 1_000), bar("20260914", 1_500)];
  const result = summarizeChatPriceRange({ period: "12m", baseDate: "20260914", bars });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.summary.requested, { from: "20250914", to: "20260914" });
  assert.deepEqual(result.summary.actual, { from: "20260401", to: "20260914" });
  assert.equal(result.summary.coverage.limitedBySource, true);
  assert.deepEqual(result.summary.coverage.source, { from: "20260401", to: "20260914" });
});

test("거래일이 20일 안팎인 정상 1개월 구간은 자료 부족으로 표시하지 않는다", () => {
  // 20260817~20260911 평일 20거래일. 200거래일 기준을 옮겨오면 여기서 '자료 부족'이 된다.
  const dates = [
    "20260817", "20260818", "20260819", "20260820", "20260821",
    "20260824", "20260825", "20260826", "20260827", "20260828",
    "20260831", "20260901", "20260902", "20260903", "20260904",
    "20260907", "20260908", "20260909", "20260910", "20260911",
  ];
  // 원본은 최근 1년치이므로 요청 구간(20260811~) 앞쪽 거래일도 함께 들어 있다.
  const bars = [bar("20251001", 900), bar("20260810", 950), ...dates.map((date, index) => bar(date, 1_000 + index))];
  const result = summarizeChatPriceRange({ period: "1m", baseDate: "20260911", bars });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.tradingDays, 20);
  assert.equal(result.summary.coverage.limitedBySource, false);
  assert.equal(result.summary.coverage.endsBeforeRequestedTo, false);
  assert.equal("isShortHistory" in result.summary, false, "200거래일 판정은 옮겨오지 않는다");
});

test("드문드문 있는 자료도 있는 거래일만으로 계산하고 실제 구간을 그대로 알린다", () => {
  const result = summarizeChatPriceRange({
    period: "3m",
    baseDate: "20260914",
    bars: [bar("20260703", 1_000, { high: 1_010, low: 990 }), bar("20260902", 800, { high: 820, low: 780 })],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.tradingDays, 2);
  assert.deepEqual(result.summary.actual, { from: "20260703", to: "20260902" });
  assert.equal(result.summary.coverage.endsBeforeRequestedTo, true);
  assert.equal(result.summary.closeChange, -200);
  assert.equal(result.summary.closeChangeRate, -20);
  assert.equal(result.summary.lowestLow, 780);
  assert.equal(result.summary.highestHigh, 1_010);
});

test("쓸 수 없는 값과 중복 날짜는 세어서 버린다", () => {
  const result = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260914",
    bars: [
      bar("20260901", 1_000),
      bar("20260901", 9_999), // 같은 날짜 중복
      bar("2026-09-02", 1_010), // 날짜 형식 이상
      bar("20260931", 1_020), // 달력에 없는 날짜
      bar("20260903", 0), // 종가 0
      bar("20260904", Number.NaN), // 숫자 아님
      bar("20260905", 1_030, { high: 1_000, low: 1_100 }), // 고가 < 저가
      bar("20260914", 1_100),
    ],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.tradingDays, 2, "20260901과 20260914만 남는다");
  assert.deepEqual(result.summary.coverage.dropped, { invalid: 5, duplicate: 1 });
  assert.equal(result.summary.startClose, 1_000, "중복은 첫 건을 쓴다");
  assert.equal(result.summary.endClose, 1_100);
});

test("자료 없음과 구간 안 거래일 없음을 구분한다", () => {
  const empty = summarizeChatPriceRange({ period: "1m", baseDate: "20260914", bars: [] });
  assert.equal(empty.ok, false);
  if (empty.ok) return;
  assert.equal(empty.reason, "no_bars");
  assert.deepEqual(empty.requested, { from: "20260814", to: "20260914" });
  assert.equal(empty.source, null);

  const allInvalid = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260914",
    bars: [bar("20260901", -5)],
  });
  assert.equal(allInvalid.ok, false);
  if (allInvalid.ok) return;
  assert.equal(allInvalid.reason, "no_bars", "값이 전부 이상하면 자료 없음과 같이 다룬다");
  assert.deepEqual(allInvalid.dropped, { invalid: 1, duplicate: 0 });

  const outOfRange = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260914",
    bars: [bar("20260601", 1_000), bar("20260630", 1_100)],
  });
  assert.equal(outOfRange.ok, false);
  if (outOfRange.ok) return;
  assert.equal(outOfRange.reason, "no_bars_in_range");
  assert.deepEqual(outOfRange.source, { from: "20260601", to: "20260630" });
  assert.match(outOfRange.detail, /20260601~20260630/);
});

test("기간 코드와 기준일이 어긋나면 계산하지 않고 이유를 돌려준다", () => {
  const badPeriod = summarizeChatPriceRange({
    period: "6m",
    baseDate: "20260914",
    bars: [bar("20260914", 1_000)],
  });
  assert.equal(badPeriod.ok, false);
  if (badPeriod.ok) return;
  assert.equal(badPeriod.reason, "invalid_period");
  assert.equal(badPeriod.period, "6m");
  assert.equal(badPeriod.requested, null);
  assert.deepEqual(badPeriod.source, { from: "20260914", to: "20260914" });

  const badBase = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260229",
    bars: [bar("20260214", 1_000)],
  });
  assert.equal(badBase.ok, false);
  if (badBase.ok) return;
  assert.equal(badBase.reason, "invalid_base_date");
  assert.equal(badBase.requested, null);
});

test("하루치만 있으면 변화는 0이고 구간 위치는 100%로 둔다", () => {
  const result = summarizeChatPriceRange({
    period: "1m",
    baseDate: "20260914",
    bars: [bar("20260914", 1_000)],
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.summary.tradingDays, 1);
  assert.equal(result.summary.closeChange, 0);
  assert.equal(result.summary.closeChangeRate, 0);
  assert.equal(result.summary.rangePositionRate, 100, "고가와 저가가 같은 경우");
  assert.deepEqual(result.summary.actual, { from: "20260914", to: "20260914" });
});
