export function formatYyyyMmDd(date: Date, timeZone = "Asia/Seoul"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}${m}${d}`;
}

export function subtractDaysYyyyMmDd(basDt: string, days: number): string {
  const y = Number(basDt.slice(0, 4));
  const m = Number(basDt.slice(4, 6));
  const d = Number(basDt.slice(6, 8));
  // 시/분/초 대신 정오(UTC)를 기준으로 계산해 타임존·DST 경계에서 날짜가
  // 밀리는 것을 피한다.
  const noonUtc = new Date(Date.UTC(y, m - 1, d, 12));
  noonUtc.setUTCDate(noonUtc.getUTCDate() - days);
  const yy = noonUtc.getUTCFullYear();
  const mm = String(noonUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(noonUtc.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}`;
}

/**
 * 오늘부터 거슬러 올라가며 실제로 데이터가 있는(totalCount > 0) 가장 최근
 * 날짜를 찾는다. 요일을 계산하지 않는다 — 주말은 물론, 특정 요일이라도
 * 데이터가 없는 휴장일(연휴 등)까지 같은 방식으로 걸러낸다.
 */
export async function findLatestTradingDate(
  checkTotalCount: (basDt: string) => Promise<number>,
  fromDate: string,
  maxLookbackDays = 14
): Promise<string> {
  for (let i = 0; i <= maxLookbackDays; i++) {
    const candidate = i === 0 ? fromDate : subtractDaysYyyyMmDd(fromDate, i);
    const totalCount = await checkTotalCount(candidate);
    if (totalCount > 0) {
      return candidate;
    }
  }
  throw new Error(
    `최근 ${maxLookbackDays}일 안에서 데이터가 있는 거래일을 찾지 못했습니다.`
  );
}
