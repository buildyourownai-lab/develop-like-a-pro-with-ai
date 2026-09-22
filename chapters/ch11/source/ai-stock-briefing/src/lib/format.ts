export function formatPrice(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function directionWord(value: number): "상승" | "하락" | "보합" {
  if (value > 0) return "상승";
  if (value < 0) return "하락";
  return "보합";
}

export function directionSymbol(value: number): "▲" | "▼" | "－" {
  if (value > 0) return "▲";
  if (value < 0) return "▼";
  return "－";
}

export function formatChange(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("ko-KR")}`;
}

export function formatChangeRate(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

export function formatTradingValue(value: number): string {
  if (value >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(1)}조원`;
  }
  const eok = Math.round(value / 100_000_000);
  return `${eok.toLocaleString("ko-KR")}억원`;
}

export function formatVolume(value: number): string {
  if (value >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(1)}억주`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 10_000).toLocaleString("ko-KR")}만주`;
  }
  return `${value.toLocaleString("ko-KR")}주`;
}

export function formatBaseDateLabel(basDt: string): string {
  if (!/^\d{8}$/.test(basDt)) return basDt;
  const y = basDt.slice(0, 4);
  const m = basDt.slice(4, 6);
  const d = basDt.slice(6, 8);
  const weekday = ["일", "월", "화", "수", "목", "금", "토"][
    new Date(Date.UTC(Number(y), Number(m) - 1, Number(d))).getUTCDay()
  ];
  return `${y}.${m}.${d} (${weekday})`;
}

export function formatShortDate(basDt: string): string {
  if (!/^\d{8}$/.test(basDt)) return basDt;
  return `${basDt.slice(0, 4)}.${basDt.slice(4, 6)}.${basDt.slice(6, 8)}`;
}
