"use client";

/**
 * 서버에서 난 오류의 원래 메시지는 브라우저로 오지 않는다.
 * 인증키가 섞인 메시지가 새 나가지 않게 Next가 막아 주기 때문이다.
 * 그래서 독자에게는 사람이 읽을 문장을 보여 주고, 원인 추적용 digest만 함께 남긴다.
 */
export default function ErrorScreen({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card notice error" role="alert">
      <strong>공식 데이터를 불러오지 못했습니다</strong>
      <p>금융위원회 주식 데이터를 받아오는 중에 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.</p>
      <p style={{ fontSize: 12, color: "var(--faint)" }}>
        공공데이터포털 점검이나 일시적인 응답 지연일 수 있습니다. 화면에 없는 숫자를 임의로 채우지 않습니다.
        {error.digest && ` (오류 번호 ${error.digest})`}
      </p>
      <button className="retry" type="button" onClick={reset}>
        다시 시도
      </button>
    </div>
  );
}
