/**
 * 챗봇 `get_price_summary`의 기간 계산부. 순수 함수만 있고 network·Cache·환경변수를 쓰지 않는다.
 *
 * 하는 일은 두 가지다.
 * 1. 최근 확인 가격 기준일에서 **서울 날짜로 거슬러 센 달력 1·3·12개월** 요청 범위를 만든다.
 *    대응 날짜가 없는 월말은 그 달 말일로 맞춘다(예: 3월 31일 −1개월 → 2월 28일, 윤년이면 29일).
 * 2. 이미 받아 둔 최근 1년 일봉 배열을 그 범위로 잘라, 요청 범위·실제 거래일 구간·거래일 수·
 *    자료 부족을 **구분해서** 돌려준다.
 *
 * 하지 않는 일:
 * - 22거래일·66거래일을 달력 1개월·3개월과 같다고 보지 않는다. 자르는 기준은 언제나 날짜다.
 * - 일봉을 새로 받아오지 않는다. 입력 배열이 원본의 제공 구간을 그대로 나타낸다고 본다.
 * - 브리핑의 200거래일 미만 '자료 부족' 판정(`isShortHistory`)을 옮겨오지 않는다.
 *   달력 1개월 구간은 정상적으로 20거래일 안팎이므로, 그 기준을 쓰면 모든 1개월 답변이
 *   자료 부족으로 표시된다. 부족 여부는 **요청 범위와 원본 제공 구간의 관계**로만 말한다.
 *
 * 계산 자체는 기존 `summarizePriceHistory`를 그대로 재사용한다(기존 함수와 반환 모양은 바꾸지 않는다).
 * 그 결과 중 `isShortHistory`만 의도적으로 옮기지 않는다.
 */

import { summarizePriceHistory } from "./briefing-facts";
import type { DailyBar } from "./types";

/**
 * 지원하는 기간 코드와 달력 개월 수.
 * 값은 `chat-tools.ts`의 도구 enum(`1m`/`3m`/`12m`)과 같지만, 그 module을 import하지는 않는다.
 * 이 파일은 계약·도구 정의가 바뀌어도 그대로 쓸 수 있는 순수 계산부로 남긴다.
 */
export const CHAT_PRICE_PERIOD_MONTHS = { "1m": 1, "3m": 3, "12m": 12 } as const;

/** `"1m" | "3m" | "12m"`. 임의 시작·종료일은 받지 않는다. */
export type ChatPricePeriodCode = keyof typeof CHAT_PRICE_PERIOD_MONTHS;

/** 시작·종료일을 모두 포함하는 `YYYYMMDD` 구간. */
export type ChatPriceDateRange = { from: string; to: string };

/** 입력 배열에서 계산에 쓰지 않고 버린 일봉 수. 0이 아니면 원본에 이상이 있었다는 뜻이다. */
export type ChatPriceDropped = {
  /** 날짜 형식이나 가격이 값으로 쓸 수 없어 버린 수 */
  invalid: number;
  /** 같은 날짜가 두 번 이상 와서 첫 건만 남기고 버린 수 */
  duplicate: number;
};

/** 요청 범위를 원본 제공 구간이 얼마나 덮는지. '자료 부족'을 한 마디로 단정하지 않기 위한 값이다. */
export type ChatPriceCoverage = {
  /** 입력 배열에서 확인된 가장 이른/늦은 거래일. 원본이 실제로 제공한 구간이다. */
  source: ChatPriceDateRange;
  /**
   * 요청 시작일이 원본 제공 구간보다 앞서서, 실제 구간이 요청보다 짧다.
   * 12개월 요청에서 주로 생긴다(원본이 최근 1년만 주고, 상장 이력이 짧을 수도 있다).
   * 원인이 상장 이력인지 원본 제공 범위인지는 이 값만으로 알 수 없다.
   */
  limitedBySource: boolean;
  /** 요청 종료일(가격 기준일)에 해당하는 거래일이 구간 안에 없다(휴장·자료 지연). */
  endsBeforeRequestedTo: boolean;
  dropped: ChatPriceDropped;
};

/**
 * 확정된 가격 요약. 필드 뜻은 `summarizePriceHistory`와 같고, 기간 관련 값만 더 나눠 놓았다.
 * - `requested`: 달력으로 센 요청 범위(기준일 포함)
 * - `actual`: 그 범위 안에서 **실제로 확인된** 첫/마지막 거래일
 * 화면에는 이 둘을 함께 보여 준다. `actual`만 보여 주면 요청과 같은 구간처럼 읽힌다.
 */
export type ChatPriceSummary = {
  period: ChatPricePeriodCode;
  months: (typeof CHAT_PRICE_PERIOD_MONTHS)[ChatPricePeriodCode];
  requested: ChatPriceDateRange;
  actual: ChatPriceDateRange;
  tradingDays: number;
  startClose: number;
  endClose: number;
  highestHigh: number;
  lowestLow: number;
  closeChange: number;
  /** % 단위. 시작 종가가 0이면 0으로 둔다(기존 계산과 같은 규칙). */
  closeChangeRate: number;
  /** 구간 저가~고가에서 마지막 종가의 위치(%). */
  rangePositionRate: number;
  coverage: ChatPriceCoverage;
};

/**
 * 요약을 만들 수 없는 경우. 예외를 던지지 않고 이유를 구분해 돌려준다.
 * - `invalid_period`: 지원하지 않는 기간 코드(모호한 기간은 여기서 되묻기로 이어진다)
 * - `invalid_base_date`: 기준일이 `YYYYMMDD` 달력 날짜가 아니다
 * - `no_bars`: 쓸 수 있는 일봉이 아예 없다(조회 결과 없음 또는 전부 이상값)
 * - `no_bars_in_range`: 일봉은 있지만 요청 범위 안에 거래일이 없다
 */
export type ChatPriceUnavailable = {
  ok: false;
  reason: "invalid_period" | "invalid_base_date" | "no_bars" | "no_bars_in_range";
  /** 그대로 사용자에게 보여 줄 수 있는 한 줄. 내부 함수명·JSON을 담지 않는다. */
  detail: string;
  /** 받은 기간 코드 원문(검증 실패 원인을 그대로 남긴다). */
  period: string;
  requested: ChatPriceDateRange | null;
  /** 원본에서 확인된 제공 구간. 확인할 수 없으면 `null`. */
  source: ChatPriceDateRange | null;
  dropped: ChatPriceDropped;
};

export type ChatPriceResult = { ok: true; summary: ChatPriceSummary } | ChatPriceUnavailable;

const COMPACT_DATE_PATTERN = /^\d{8}$/;
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** 그 달의 마지막 날. 2월은 윤년 규칙(4·100·400)을 따른다. */
export function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return MONTH_LENGTHS[month - 1];
}

/** `YYYYMMDD`이면서 달력에 실제로 있는 날짜인지. `20260231`·`20261301`은 거짓이다. */
export function isCompactDate(value: unknown): value is string {
  if (typeof value !== "string" || !COMPACT_DATE_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  if (month < 1 || month > 12 || day < 1) {
    return false;
  }
  return day <= daysInMonth(year, month);
}

function toCompact(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}${String(month).padStart(2, "0")}${String(day).padStart(2, "0")}`;
}

/**
 * 달력으로 개월을 거슬러 센다. 시간대·Date 객체를 쓰지 않는 날짜만의 계산이다.
 * 대응 날짜가 없으면 그 달 말일로 맞춘다: `20260331` −1개월 → `20260228`,
 * `20240331` −1개월 → `20240229`, `20240229` −12개월 → `20230228`.
 */
export function subtractCalendarMonths(compact: string, months: number): string {
  if (!isCompactDate(compact)) {
    throw new Error(`달력 날짜가 아닙니다: ${compact}`);
  }
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));

  const totalMonths = year * 12 + (month - 1) - months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  return toCompact(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export function isChatPricePeriod(value: unknown): value is ChatPricePeriodCode {
  return typeof value === "string" && Object.hasOwn(CHAT_PRICE_PERIOD_MONTHS, value);
}

/**
 * 기준일과 기간 코드로 요청 범위를 만든다. 시작·종료일을 모두 포함한다.
 * 기준일 자체가 종료일이므로, 기준일에 거래가 없었는지는 이 함수가 알 수 없다.
 */
export function chatPriceRequestedRange(baseDate: string, period: ChatPricePeriodCode): ChatPriceDateRange {
  const months = CHAT_PRICE_PERIOD_MONTHS[period];
  return { from: subtractCalendarMonths(baseDate, months), to: baseDate };
}

function isUsablePrice(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** 계산에 쓸 수 있는 일봉인지. 날짜가 달력 날짜여야 하고 종가·고가·저가가 양수여야 한다. */
function isUsableBar(bar: DailyBar): boolean {
  if (!isCompactDate(bar.date)) {
    return false;
  }
  if (!isUsablePrice(bar.close) || !isUsablePrice(bar.high) || !isUsablePrice(bar.low)) {
    return false;
  }
  return bar.high >= bar.low;
}

/**
 * 입력 배열을 건드리지 않고 날짜 오름차순으로 정리한다.
 * 이상값과 중복 날짜는 세어서 함께 돌려주고, 중복은 정렬 후 첫 건만 남긴다.
 */
function normalizeBars(bars: readonly DailyBar[]): { usable: DailyBar[]; dropped: ChatPriceDropped } {
  const valid = bars.filter(isUsableBar);
  const sorted = [...valid].sort((a, b) => a.date.localeCompare(b.date));

  const usable: DailyBar[] = [];
  const seen = new Set<string>();
  for (const bar of sorted) {
    if (seen.has(bar.date)) {
      continue;
    }
    seen.add(bar.date);
    usable.push(bar);
  }

  return {
    usable,
    dropped: { invalid: bars.length - valid.length, duplicate: sorted.length - usable.length },
  };
}

/**
 * 요청 기간만큼 잘라 가격 요약을 확정한다.
 *
 * `bars`는 이미 받아 둔 배열이며(예: `fetchStockHistory`의 `bars`) 여기서 다시 조회하지 않는다.
 * 입력 배열은 정렬·수정하지 않는다.
 */
export function summarizeChatPriceRange(input: {
  period: string;
  baseDate: string;
  bars: readonly DailyBar[];
}): ChatPriceResult {
  const { usable, dropped } = normalizeBars(input.bars);
  const source: ChatPriceDateRange | null =
    usable.length === 0 ? null : { from: usable[0].date, to: usable[usable.length - 1].date };

  if (!isChatPricePeriod(input.period)) {
    return {
      ok: false,
      reason: "invalid_period",
      detail: `지원하는 기간은 달력 1개월·3개월·12개월입니다(${Object.keys(CHAT_PRICE_PERIOD_MONTHS).join(", ")}). 어느 기간인지 알려 주세요.`,
      period: input.period,
      requested: null,
      source,
      dropped,
    };
  }
  if (!isCompactDate(input.baseDate)) {
    return {
      ok: false,
      reason: "invalid_base_date",
      detail: "가격 기준일을 확인하지 못해 기간을 셀 수 없습니다.",
      period: input.period,
      requested: null,
      source,
      dropped,
    };
  }

  const requested = chatPriceRequestedRange(input.baseDate, input.period);

  if (source === null) {
    return {
      ok: false,
      reason: "no_bars",
      detail: "확인된 일별 시세가 없습니다.",
      period: input.period,
      requested,
      source: null,
      dropped,
    };
  }

  const inRange = usable.filter((bar) => bar.date >= requested.from && bar.date <= requested.to);
  if (inRange.length === 0) {
    return {
      ok: false,
      reason: "no_bars_in_range",
      detail: `요청한 구간(${requested.from}~${requested.to})에 확인된 거래일이 없습니다. 확인된 자료는 ${source.from}~${source.to}입니다.`,
      period: input.period,
      requested,
      source,
      dropped,
    };
  }

  // 계산은 기존 함수를 그대로 쓴다. `isShortHistory`(200거래일 기준)는 여기로 옮기지 않는다.
  const facts = summarizePriceHistory(inRange);

  return {
    ok: true,
    summary: {
      period: input.period,
      months: CHAT_PRICE_PERIOD_MONTHS[input.period],
      requested,
      actual: { from: facts.from, to: facts.to },
      tradingDays: facts.tradingDays,
      startClose: facts.startClose,
      endClose: facts.endClose,
      highestHigh: facts.highestHigh,
      lowestLow: facts.lowestLow,
      closeChange: facts.closeChange,
      closeChangeRate: facts.closeChangeRate,
      rangePositionRate: facts.rangePositionRate,
      coverage: {
        source,
        limitedBySource: requested.from < source.from,
        endsBeforeRequestedTo: facts.to < requested.to,
        dropped,
      },
    },
  };
}
