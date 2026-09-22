const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** 서버가 어느 시간대에 있어도 한국 기준 날짜를 쓴다. */
export function seoulToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts.replaceAll("-", "");
}

function toUtcDate(compact: string): Date {
  const year = Number(compact.slice(0, 4));
  const month = Number(compact.slice(4, 6));
  const day = Number(compact.slice(6, 8));
  return new Date(Date.UTC(year, month - 1, day));
}

function toCompact(date: Date): string {
  return date.toISOString().slice(0, 10).replaceAll("-", "");
}

export function shiftDays(compact: string, days: number): string {
  const date = toUtcDate(compact);
  date.setUTCDate(date.getUTCDate() + days);
  return toCompact(date);
}

export function shiftYears(compact: string, years: number): string {
  const date = toUtcDate(compact);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return toCompact(date);
}

/** "20260818" -> "2026.08.18 (화)" */
export function formatBaseDate(compact: string): string {
  if (!/^\d{8}$/.test(compact)) {
    return compact;
  }
  const weekday = WEEKDAYS[toUtcDate(compact).getUTCDay()];
  return `${compact.slice(0, 4)}.${compact.slice(4, 6)}.${compact.slice(6, 8)} (${weekday})`;
}

/** 차트 축에 쓰는 짧은 표기. "20260818" -> "26.08" */
export function formatMonthLabel(compact: string): string {
  return `${compact.slice(2, 4)}.${compact.slice(4, 6)}`;
}

/** 차트 tooltip에 쓰는 표기. "20260818" -> "2026.08.18" */
export function formatShortDate(compact: string): string {
  return `${compact.slice(0, 4)}.${compact.slice(4, 6)}.${compact.slice(6, 8)}`;
}

/** 기준일이 오늘로부터 며칠 전인지. 데이터가 얼마나 늦은지 화면에 알려 주기 위해 쓴다. */
export function daysBehindToday(compact: string, now: Date = new Date()): number {
  const diff = toUtcDate(seoulToday(now)).getTime() - toUtcDate(compact).getTime();
  return Math.round(diff / 86_400_000);
}
