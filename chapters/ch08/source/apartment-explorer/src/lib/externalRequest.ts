/*
  국토교통부와 Kakao는 둘 다 연결을 받아놓고 응답을 주지 않는 때가 있다. 제한을 두지
  않으면 검색이 끝나지 않아 화면이 계속 "찾는 중"에 머물고, 무엇이 막혔는지도 알 수 없다.
  두 API가 같은 방식으로 다시 시도하도록 여기에 모았다.
*/

/**
 * fetch가 연결 실패로 던지는 오류는 message가 "fetch failed" 한 줄뿐이고, 실제 이유는
 * cause에 들어 있다. 그것까지 꺼내야 무엇이 끊겼는지 서버 기록에 남는다.
 */
export function failureReason(error: unknown): string {
  const cause = (error as { cause?: unknown } | null)?.cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: string }).code;
    return code ? `${code} ${cause.message}` : cause.message;
  }
  if (error instanceof Error) {
    return error.name === "Error" ? error.message : `${error.name} ${error.message}`;
  }
  return String(error);
}

export interface RetryingRequest {
  /** 실패를 알릴 때 사람이 읽는 이름. 예: MOLIT API */
  label: string;
  url: string;
  init?: RequestInit;
  /** 시도마다 앞에 두는 대기 시간. 길이가 시도 횟수다. */
  retryDelays: number[];
  /** 시도 하나가 아니라 재시도 전체에 주는 시간이다. 사용자가 기다리는 시간의 상한이 된다. */
  deadlineMs: number;
  /** 서비스별 오류 타입으로 감싼다. 어느 쪽 데이터를 못 가져왔는지 계속 구분하기 위해서다. */
  fail: (message: string) => Error;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/*
  외부 API는 두 가지로 실패한다. 응답 코드로 거절하는 것과 연결 자체가 열리지 않는 것이다.
  뒤쪽은 fetch가 예외로 던지므로 감싸지 않으면 예상하지 못한 오류로 새어 나가고, 사용자는
  검색 조건이 잘못된 줄 오해한다. 연결 실패는 다시 시도하면 붙는 경우가 많아 HTTP 429와
  같은 사다리를 태우고, 사다리를 다 쓰면 어느 API가 끊겼는지 밝혀 알린다.

  시간 제한은 시도마다 따로 두지 않고 재시도 전체에 하나만 둔다. 시도마다 두면 응답을
  주지 않는 API에 제한 시간 x 시도 횟수만큼 묶이고, 사용자는 답이 오지 않는 화면을 몇 분씩
  본다. 하나로 두면 그 시간이 기다리는 시간의 상한이 된다.
*/
export async function requestWithRetry({
  label,
  url,
  init,
  retryDelays,
  deadlineMs,
  fail,
}: RetryingRequest): Promise<Response> {
  const signal = AbortSignal.timeout(deadlineMs);
  for (const [attempt, delay] of retryDelays.entries()) {
    if (delay) await sleep(delay);
    const lastAttempt = attempt === retryDelays.length - 1;
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal });
    } catch (error) {
      // 예산을 다 쓴 뒤에는 남은 대기 시간을 더 태우지 않는다.
      if (lastAttempt || signal.aborted) {
        throw fail(`${label} 요청에 실패했습니다: ${failureReason(error)}`);
      }
      continue;
    }
    if (response.ok) return response;
    if (response.status !== 429 || lastAttempt) return response;
  }
  throw fail(`${label} 재시도 한도를 초과했습니다.`);
}
