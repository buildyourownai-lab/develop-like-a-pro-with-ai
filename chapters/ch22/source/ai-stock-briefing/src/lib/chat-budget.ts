/**
 * 대화 한 번(HTTP 요청 하나)의 호출 상한. 자동 재시도와 무한 반복을 만들지 않고,
 * 상한에 닿으면 확보한 자료와 미확인을 알린다. 상한은 초기값이며 실제 spike로 검증한 뒤 확정한다.
 */
export const CHAT_MODEL_CALL_LIMIT = 3;
/** 조회 실행 상한. 모델 호출·도구 실행·하위 외부 API 호출은 서로 다른 수로 센다. */
export const CHAT_LOOKUP_LIMIT = 4;
export const CHAT_TOTAL_TIME_LIMIT_MS = 30_000;
/** 응답 길이 상한. 답변이 잘리면 형식 검사에서 걸러지고 자동 재시도는 하지 않는다. */
export const CHAT_MAX_OUTPUT_TOKENS = 800;

export type ChatBudgetReason = "model_calls" | "lookups" | "time";

export class ChatBudgetExceededError extends Error {
  constructor(
    message: string,
    readonly reason: ChatBudgetReason
  ) {
    super(message);
    this.name = "ChatBudgetExceededError";
  }
}

export type ChatCallBudgetOptions = {
  modelCalls?: number;
  lookups?: number;
  totalTimeMs?: number;
  /** Test에서 시간 흐름을 직접 주도록 열어 둔다. */
  now?: () => number;
};

/** 남은 시간과 호출 수를 한곳에서 예약한다. 예약에 실패하면 외부 호출을 시작하지 않는다. */
export class ChatCallBudget {
  private readonly modelCallLimit: number;
  private readonly lookupLimit: number;
  private readonly totalTimeMs: number;
  private readonly now: () => number;
  private readonly startedAt: number;
  private modelCalls = 0;
  private lookups = 0;

  constructor(options: ChatCallBudgetOptions = {}) {
    this.modelCallLimit = options.modelCalls ?? CHAT_MODEL_CALL_LIMIT;
    this.lookupLimit = options.lookups ?? CHAT_LOOKUP_LIMIT;
    this.totalTimeMs = options.totalTimeMs ?? CHAT_TOTAL_TIME_LIMIT_MS;
    this.now = options.now ?? (() => Date.now());
    this.startedAt = this.now();
  }

  remainingMs(): number {
    return Math.max(0, this.totalTimeMs - (this.now() - this.startedAt));
  }

  usage(): { modelCalls: number; lookups: number } {
    return { modelCalls: this.modelCalls, lookups: this.lookups };
  }

  /**
   * 남은 시간이 없으면 던진다. 비동기 작업 **전과 후**에 모두 부른다.
   * 뒤에서도 확인해야 하는 이유: 45초까지 걸릴 수 있는 기존 조회 함수는 abort signal을 받지
   * 않으므로, 기다림을 끊은 뒤에도 늦게 도착한 결과를 그대로 받으면 30초 상한이 무의미해진다.
   */
  assertTimeLeft(): void {
    this.ensureTimeLeft();
  }

  private ensureTimeLeft(): void {
    if (this.remainingMs() <= 0) {
      throw new ChatBudgetExceededError("답변 준비 시간이 끝났습니다.", "time");
    }
  }

  /**
   * 남은 시간만큼만 기다린다. 시간이 끝나면 기다림을 끊고 `time` 사유로 던진다.
   *
   * 여기서 끊는 것은 **이 요청의 기다림**뿐이다. 기존 조회 함수(`fscFetch` 등)는 abort
   * signal을 받지 않으므로 이미 시작된 외부 호출과 그 비용이 취소된다고 말하지 않는다.
   * 대신 끊은 뒤에는 새 하위 작업을 시작하지 않고, 늦게 실패한 promise는 관측만 해 둔다.
   */
  async withDeadline<T>(work: Promise<T>): Promise<T> {
    this.ensureTimeLeft();
    // 기다림을 끊은 뒤 늦게 rejected될 promise를 관측해 unhandled rejection으로 남기지 않는다.
    void work.catch(() => {});

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new ChatBudgetExceededError("답변 준비 시간이 끝났습니다.", "time")),
        this.remainingMs()
      );
    });

    try {
      return await Promise.race([work, deadline]);
    } finally {
      // 남은 timer는 반드시 정리한다. 성공했을 때도 요청이 timer 때문에 늦게 끝나지 않게 한다.
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** 모델 호출 직전에 부른다. 반환한 시간만큼만 기다린다. */
  reserveModelCall(): { timeoutMs: number } {
    this.ensureTimeLeft();
    if (this.modelCalls >= this.modelCallLimit) {
      throw new ChatBudgetExceededError("한 질문에 허용한 AI 호출 수를 넘었습니다.", "model_calls");
    }
    this.modelCalls += 1;
    return { timeoutMs: this.remainingMs() };
  }

  /** 조회 실행 직전에 부른다. 예약한 수이며 하위 외부 API 호출 수와 같지 않다. */
  reserveLookup(): { timeoutMs: number } {
    this.ensureTimeLeft();
    if (this.lookups >= this.lookupLimit) {
      throw new ChatBudgetExceededError("한 질문에 허용한 조회 수를 넘었습니다.", "lookups");
    }
    this.lookups += 1;
    return { timeoutMs: this.remainingMs() };
  }
}
