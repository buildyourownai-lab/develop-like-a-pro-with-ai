export type Direction = "up" | "down" | "flat";

export function directionOf(value: number): Direction {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

/** 색만으로 상승·하락을 알리지 않기 위해 기호를 함께 쓴다. */
export function directionMark(direction: Direction): string {
  if (direction === "up") return "▲";
  if (direction === "down") return "▼";
  return "―";
}

export function directionLabel(direction: Direction): string {
  if (direction === "up") return "상승";
  if (direction === "down") return "하락";
  return "보합";
}

export function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("ko-KR");
}

export function formatPrice(value: number): string {
  return Number.isInteger(value) ? formatInteger(value) : value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

export function formatSignedNumber(value: number): string {
  const body = formatPrice(Math.abs(value));
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return body;
}

export function formatSignedRate(value: number): string {
  const body = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) return `+${body}`;
  if (value < 0) return `-${body}`;
  return body;
}

/** 거래대금은 원 단위 숫자가 너무 길어 조·억으로 줄여 읽는다. */
export function formatTradeValue(value: number): string {
  if (value >= 1_0000_0000_0000) {
    return `${(value / 1_0000_0000_0000).toFixed(1)}조원`;
  }
  if (value >= 1_0000_0000) {
    return `${formatInteger(value / 1_0000_0000)}억원`;
  }
  if (value <= 0) {
    return "0원";
  }
  return `${formatInteger(value)}원`;
}

export function formatVolume(value: number): string {
  if (value >= 1_0000_0000) {
    return `${(value / 1_0000_0000).toFixed(1)}억주`;
  }
  if (value >= 1_0000) {
    return `${formatInteger(value / 1_0000)}만주`;
  }
  return `${formatInteger(value)}주`;
}
