import { directionSymbol, directionWord } from "@/lib/format";

// 상승/하락을 색만으로 전달하지 않기 위한 공통 표시. 눈으로는 기호(▲/▼)와
// 부호(+/-)가 같이 보이고, 화면 읽기 도구에는 "상승"/"하락" 낱말로 읽힌다.
export function ChangeIndicator({
  value,
  visibleText,
}: {
  value: number;
  visibleText: string;
}) {
  const direction = value > 0 ? "up" : value < 0 ? "down" : "flat";

  return (
    <span className={`market-change ${direction}`}>
      <span aria-hidden="true">{directionSymbol(value)} </span>
      {visibleText}
      <span className="visually-hidden">{directionWord(value)}</span>
    </span>
  );
}
