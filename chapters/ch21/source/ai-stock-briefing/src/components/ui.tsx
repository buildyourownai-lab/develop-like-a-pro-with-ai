import {
  directionLabel,
  directionMark,
  directionOf,
  formatSignedNumber,
  formatSignedRate,
} from "@/lib/format";
import { daysBehindToday, formatBaseDate } from "@/lib/trading-date";

/** 등락률 알약. 색만으로 알리지 않도록 기호·부호·상승/하락 글자를 함께 준다. */
export function RatePill({ rate }: { rate: number }) {
  const direction = directionOf(rate);
  return (
    <span className={`pill ${direction}`}>
      <span aria-hidden="true">{directionMark(direction)}</span>
      {formatSignedRate(rate)}
      <span className="visually-hidden">{directionLabel(direction)}</span>
    </span>
  );
}

/** 기준가와 비교한 등락과 등락률을 한 줄로 보여 준다. */
export function ChangeFigure({ diff, rate }: { diff: number; rate: number }) {
  const direction = directionOf(rate);
  return (
    <span className={`change ${direction}`}>
      <span className="mark" aria-hidden="true">
        {directionMark(direction)}
      </span>
      <span>
        {formatSignedNumber(diff)} ({formatSignedRate(rate)})
      </span>
      <span className="visually-hidden">{directionLabel(direction)}</span>
    </span>
  );
}

/** 이 숫자가 언제 기준인지 늘 같은 모양으로 보여 준다. */
export function BaseDateBadge({ label, baseDate }: { label: string; baseDate: string }) {
  const lag = daysBehindToday(baseDate);
  return (
    <span className="basedate">
      <span className="label">{label}</span>
      <span className="value">{formatBaseDate(baseDate)}</span>
      <span className="lag">{lag <= 0 ? "당일 제공" : `${lag}일 전 자료`}</span>
    </span>
  );
}

export function SearchBar({ defaultValue = "" }: { defaultValue?: string }) {
  return (
    <form className="searchbar" action="/search" method="get" role="search">
      <label className="visually-hidden" htmlFor="q">
        종목명 또는 종목코드
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={defaultValue}
        placeholder="종목명 또는 종목코드로 찾기 (예: SK하이닉스, 000660)"
        autoComplete="off"
      />
      <button type="submit">찾기</button>
    </form>
  );
}

function seoulNow(): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());
}

export function SourceFootnote({ extra }: { extra?: string[] }) {
  return (
    <footer className="footnote">
      <p>이 화면은 {seoulNow()}에 조회한 결과입니다.</p>
      <ul>
        <li>출처: 금융위원회 주식시세정보·지수시세정보·KRX상장종목정보 (공공데이터포털)</li>
        <li>실시간 시세가 아니라 공공데이터포털이 제공한 가장 최근 거래일 자료입니다.</li>
        {extra?.map((line) => (
          <li key={line}>{line}</li>
        ))}
        <li>투자 판단이나 추천을 제공하지 않습니다.</li>
      </ul>
    </footer>
  );
}
