"use client";

import { useEffect, useId, useRef, useState } from "react";
import { usePathname } from "next/navigation";

import {
  CHAT_MAX_HISTORY_MESSAGES,
  CHAT_MAX_QUESTION_LENGTH,
  type ChatAnswerPayload,
  type ChatSelectionInput,
  type ChatTarget,
  type ChatTurn,
  chatViewportMetrics,
  isChatStockCode,
  shouldAcceptChatResponse,
} from "@/lib/chat-contract";

type ChatMessage =
  | { kind: "question"; id: string; text: string }
  | { kind: "note"; id: string; text: string }
  | { kind: "answer"; id: string; payload: ChatAnswerPayload };

/** 후보를 고를 때까지 브라우저 메모리에만 보관하는 원래 질문. 서버에는 저장하지 않는다. */
type PendingSelection = {
  /** 후보를 낸 답변 message의 id. 최신 답변에만 선택 버튼을 둔다. */
  messageId: string;
  question: string;
  searchQuery: string;
};

/**
 * 상세 화면의 route 종목코드. 대화 대상의 최초 기본값이며 서버가 다시 확인한다.
 *
 * 형식은 기존 종목코드 규칙(`isChatStockCode`)과 같아야 한다. 여섯 자리 숫자만 받으면
 * 마지막 자리가 영문인 기존 종목(`00088K` 등) 상세 화면에서 문맥이 사라진다.
 * 규칙을 여기서 더 넓히지도 않는다.
 */
function routeCodeOf(pathname: string): string | null {
  const code = /^\/stocks\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
  return code !== null && isChatStockCode(code) ? code : null;
}

/** 실패했을 때 화면에 남은 마지막 질문을 지운다. 질문 원문은 입력창으로 되돌린다. */
function withoutLastQuestion(messages: ChatMessage[]): ChatMessage[] {
  const lastQuestion = messages.findLastIndex((message) => message.kind === "question");
  return lastQuestion < 0 ? messages : messages.filter((_, index) => index !== lastQuestion);
}

/**
 * 대상이 바뀌면 이전 종목 대화는 버리지만 **전환을 요청한 이번 turn은 남긴다.**
 *
 * 새 질문이면 그 질문 message를 남긴다. 후보를 골라 이어가는 요청은 새 질문 message를 만들지
 * 않으므로, 화면에 남아 있는 원래 질문과 선택 안내를 남긴다. 그것까지 지우면 답변만 남아
 * 무엇을 물었는지 알 수 없게 된다.
 */
function keptTurn(previous: ChatMessage[], appended: ChatMessage | null, asked: string): ChatMessage[] {
  if (appended) return [appended];
  const lastQuestion = previous.findLastIndex((message) => message.kind === "question");
  // 화면 기록이 없으면(지운 직후 등) 보낸 질문 문장으로 한 줄을 만든다.
  if (lastQuestion < 0) return [{ kind: "question", id: "q-resumed", text: asked }];
  return previous.slice(lastQuestion).filter((message) => message.kind !== "answer");
}

/**
 * 최근 왕복만 언어 문맥으로 보낸다.
 *
 * 일반 설명은 요약 한 줄로 줄이지 않고 **본문 문장까지 그대로** 담는다. 요약만 보내면 다음
 * 질문("그럼 그 두 번째 항목은?")의 문맥이 사라진다. 대신 담는 범위를 최근 3회 왕복으로 제한한다.
 *
 * 확인된 자료(수치·날짜·링크·기준일)는 담지 않는다. history는 서버가 사실 근거로 믿지 않는
 * 입력이므로, 자료를 여기에 실어 보내면 검증되지 않은 값이 사실처럼 돌아올 수 있다.
 */
function historyOf(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const message of messages) {
    if (message.kind === "question") {
      turns.push({ role: "user", text: message.text });
      continue;
    }
    if (message.kind === "note") continue;
    const general = message.payload.general;
    const text = general
      ? [general.summary, ...general.points].join(" ")
      : (message.payload.status?.message ?? message.payload.selection?.message);
    if (text) turns.push({ role: "model", text: text.slice(0, CHAT_MAX_QUESTION_LENGTH) });
  }
  return turns.slice(-CHAT_MAX_HISTORY_MESSAGES);
}

/** `12345` → `12,345`. 서버가 계산한 값만 표시 형식으로 바꾼다. */
function formatNumber(value: number): string {
  return value.toLocaleString("ko-KR");
}

/** 부호를 붙인 변화. 서버가 준 값을 그대로 쓰고 여기서 다시 계산하지 않는다. */
function formatSigned(value: number, digits = 0): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toLocaleString("ko-KR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

/** `20260914` → `2026.09.14`. 서버가 준 값만 표시 형식으로 바꾼다. */
function formatCompactDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}.${value.slice(4, 6)}.${value.slice(6)}` : value;
}

function formatPreparedAt(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime())
    ? value
    : time.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * 공통 layout에 들어가는 독립 leaf Client Component.
 * 대화 내용은 pathname을 key로 둔 하위 Component 안에만 있으므로 실제 route 이동이면 새 대화로 시작하고,
 * 같은 화면에서 닫았다 열면 그대로 이어진다. 브라우저 저장소를 쓰지 않아 새로고침으로도 끝난다.
 */
export function ChatPanel({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);

  function closePanel() {
    setOpen(false);
    launcherRef.current?.focus(); // 닫은 뒤 키보드 포커스를 원래 버튼으로 되돌린다.
  }

  // 명시적으로 꺼져 있으면 버튼도 대화 레이어도 만들지 않는다.
  if (!enabled) return null;

  return (
    <>
      <button
        type="button"
        className="chat-launcher"
        // 대화가 열린 동안 배경을 잠글 때 대화 자신은 잠그지 않도록 표시해 둔다.
        data-chat-root=""
        ref={launcherRef}
        aria-expanded={open}
        onClick={() => (open ? closePanel() : setOpen(true))}
      >
        {open ? "대화 닫기" : "AI에게 질문"}
      </button>
      <ChatSession key={pathname} open={open} routeCode={routeCodeOf(pathname)} onClose={closePanel} />
    </>
  );
}

function ChatSession({
  open,
  routeCode,
  onClose,
}: {
  open: boolean;
  routeCode: string | null;
  onClose: () => void;
}) {
  const panelTitleId = useId();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** 실제로 보이는 영역(visual viewport) 값. 레이어를 이 영역에 맞춘다. */
  const [viewport, setViewport] = useState<{ keyboardInset: number; visualHeight: number } | null>(null);
  /** 서버가 확인해 준 현재 대화 대상. 브라우저가 스스로 정하지 않는다. */
  const [conversationTarget, setConversationTarget] = useState<ChatTarget | null>(null);
  const [awaitingSelection, setAwaitingSelection] = useState<PendingSelection | null>(null);
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const askedCountRef = useRef(0);

  // 화면을 떠나면 진행 중이던 요청을 중단만 시도한다. 서버 호출과 과금까지 멈춘다고 약속하지 않는다.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  /**
   * 모바일 웹에서 키보드가 올라온 만큼 레이어를 띄우고 높이도 보이는 영역 안으로 제한한다.
   *
   * `visualViewport`의 resize만 듣지 않는다. 키보드 종류·브라우저에 따라 resize가 오지 않고
   * scroll·orientationchange·window resize만 오는 경우가 있어, 그때 입력창이 가려질 수 있다.
   * `visualViewport`가 아예 없으면 창 높이를 그대로 쓰고 띄우지 않는다(값을 추측하지 않는다).
   */
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const visual = window.visualViewport ?? null;
    function update() {
      setViewport(
        chatViewportMetrics({
          layoutHeight: window.innerHeight,
          visualHeight: visual?.height ?? window.innerHeight,
          offsetTop: visual?.offsetTop ?? 0,
        })
      );
    }
    update();
    visual?.addEventListener("resize", update);
    visual?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      visual?.removeEventListener("resize", update);
      visual?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, [open]);

  /**
   * `aria-modal="true"`로 알린 대로 배경과의 상호작용을 실제로 끊는다.
   * 기존 화면의 구조·디자인은 그대로 두고, 열려 있는 동안만 대화 밖 body 자식에 `inert`를 붙인다.
   * 우리가 붙인 것만 되돌려, 원래 `inert`였던 요소를 풀지 않는다.
   */
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const marked = Array.from(document.body.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-chat-root") && !child.hasAttribute("inert")
    );
    for (const element of marked) element.setAttribute("inert", "");
    return () => {
      for (const element of marked) element.removeAttribute("inert");
    };
  }, [open]);

  useEffect(() => {
    if (open) inputRef.current?.focus(); // 열면 바로 질문을 입력할 수 있게 포커스를 옮긴다.
  }, [open]);

  useEffect(() => {
    if (open) logEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, messages, pending]);

  /** 지우기는 generation을 올려 이전 요청의 늦은 응답을 새 대화에 붙이지 않는다. */
  function clearConversation() {
    generationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    setMessages([]);
    setQuestion("");
    setPending(false);
    setErrorMessage(null);
    setConversationTarget(null);
    setAwaitingSelection(null);
  }

  /**
   * 서버 응답 한 건을 화면에 붙인다.
   * 대화 대상이 바뀐 응답이면 이전 대상의 근거와 대화를 지우고 이번 질문·답변만 남긴다.
   * @returns 대상 전환으로 generation을 올렸는지
   */
  function appendAnswer(payload: ChatAnswerPayload, askedMessage: ChatMessage | null, asked: string): boolean {
    const answer: ChatMessage = { kind: "answer", id: payload.requestId, payload };
    const switched =
      payload.target !== null &&
      conversationTarget !== null &&
      payload.target.code !== conversationTarget.code;

    if (switched) {
      // 대상 전환: 이전 근거·history는 버리고, 전환을 요청한 질문은 유지한다.
      generationRef.current += 1;
      abortRef.current = null;
      setMessages((previous) => [...keptTurn(previous, askedMessage, asked), answer]);
      setPending(false);
    } else {
      setMessages((previous) => [...previous, answer]);
    }

    if (payload.target) setConversationTarget(payload.target);
    // 원래 질문은 이 탭 메모리에만 보관한다. 서버는 pending selection을 저장하지 않는다.
    setAwaitingSelection(
      payload.selection
        ? { messageId: payload.requestId, question: asked, searchQuery: payload.selection.searchQuery }
        : null
    );
    return switched;
  }

  /**
   * 질문 한 번을 보낸다. 후보를 고른 뒤 이어가는 요청이면 `selection`과 보관한 원래 질문을 쓴다.
   * `resume`이 있으면 실패·취소 때 후보 목록과 원래 질문을 되돌려 다시 고를 수 있게 한다.
   */
  async function send(options: {
    asked: string;
    selection?: ChatSelectionInput;
    appended: ChatMessage | null;
    resume?: { selection: PendingSelection; noteId: string };
  }) {
    const { asked, selection, appended } = options;
    const generation = generationRef.current;
    const history = historyOf(messages);
    const controller = new AbortController();
    abortRef.current = controller;
    setErrorMessage(null);
    setPending(true);
    let switched = false;

    /**
     * 보내기 전 상태로 되돌린다. 자동 재시도는 하지 않는다.
     *
     * 후보 선택 재개였다면 붙였던 안내를 지우고 **후보 목록을 다시 고를 수 있게** 되돌린다.
     * 그러지 않으면 대기 상태만 사라져 같은 질문을 다시 물을 방법이 없다.
     * 원래 질문은 화면 기록에 그대로 있으므로 입력창으로 옮기지 않는다.
     */
    function restore() {
      const resume = options.resume;
      if (resume) {
        setMessages((previous) => previous.filter((message) => message.id !== resume.noteId));
        setAwaitingSelection(resume.selection);
        return;
      }
      setQuestion(asked); // 질문을 잃지 않도록 입력창에 되돌린다.
      setMessages(withoutLastQuestion);
    }

    function failWith(message: string) {
      setErrorMessage(message);
      restore();
    }

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: asked,
          history,
          routeCode,
          targetCode: conversationTarget?.code ?? null,
          selection: selection ?? null,
        }),
        signal: controller.signal,
      });
      const body: unknown = await response.json();
      // 지우기·대상 전환 뒤에 도착한 이전 요청의 응답은 붙이지 않는다.
      if (!shouldAcceptChatResponse(generation, generationRef.current)) return;
      if (!response.ok || typeof body !== "object" || body === null || !("requestId" in body)) {
        const message =
          typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
            ? body.error
            : "답변을 표시하지 못했습니다.";
        failWith(message);
        return;
      }
      switched = appendAnswer(body as ChatAnswerPayload, appended, asked);
    } catch (caught) {
      if (!shouldAcceptChatResponse(generation, generationRef.current)) return;
      if (caught instanceof DOMException && caught.name === "AbortError") {
        // 사용자가 취소했다. 오류가 아니므로 문구는 남기지 않고, 다시 물어볼 수 있는 상태로 되돌린다.
        // 이미 시작된 서버 호출과 과금까지 멈춘다는 뜻은 아니다.
        restore();
        return;
      }
      failWith("답변을 받지 못했습니다. 다시 질문해 주세요.");
    } finally {
      if (switched || shouldAcceptChatResponse(generation, generationRef.current)) setPending(false);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  async function submitQuestion(event: React.FormEvent) {
    event.preventDefault();
    const asked = question.trim();
    // 전송 중 중복 제출과 빈 입력·긴 입력은 호출 전에 막는다.
    if (pending || asked.length === 0 || asked.length > CHAT_MAX_QUESTION_LENGTH) return;

    askedCountRef.current += 1;
    const appended: ChatMessage = { kind: "question", id: `q-${askedCountRef.current}`, text: asked };
    setMessages((previous) => [...previous, appended]);
    setQuestion("");
    setAwaitingSelection(null); // 새 질문을 보내면 기다리던 후보 선택은 끝난다.
    await send({ asked, appended });
  }

  /**
   * 기다리는 요청을 취소한다. 화면은 보내기 전 상태로 되돌아가고 다시 물어볼 수 있다.
   * 이미 시작된 서버 호출과 과금까지 멈춘다는 뜻은 아니다.
   */
  function cancelRequest() {
    abortRef.current?.abort();
  }

  /** 후보를 고르면 보관한 원래 질문을 그대로 다시 보낸다. 새 질문을 만들지 않는다. */
  async function chooseCandidate(pending_: PendingSelection, candidate: ChatTarget) {
    if (pending) return;
    askedCountRef.current += 1;
    const noteId = `n-${askedCountRef.current}`;
    const note: ChatMessage = {
      kind: "note",
      id: noteId,
      text: `선택한 종목: ${candidate.name} · 종목코드 ${candidate.code}`,
    };
    setMessages((previous) => [...previous, note]);
    setAwaitingSelection(null);
    await send({
      asked: pending_.question,
      selection: { searchQuery: pending_.searchQuery, code: candidate.code },
      appended: null,
      // 서버가 후보를 다시 확인하지 못하면 이 대기 상태로 되돌려 다시 고를 수 있게 한다.
      resume: { selection: pending_, noteId },
    });
  }

  /** Tab이 레이어 밖으로 나가지 않게 한다. 포커스 복귀는 닫을 때 원래 버튼으로 한다. */
  function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const layer = layerRef.current;
    if (!layer) return;
    const focusable = Array.from(
      layer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !layer.contains(active))) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // 닫힌 동안에는 화면에 아무것도 만들지 않고 새 외부 호출도 하지 않는다. 대화 내용은 메모리에 남는다.
  if (!open) return null;

  const headTarget = conversationTarget;
  const headCode = headTarget?.code ?? routeCode;

  return (
    <div
      className="chat-layer"
      role="dialog"
      aria-modal="true"
      aria-labelledby={panelTitleId}
      data-chat-root=""
      ref={layerRef}
      onKeyDown={trapTab}
      style={
        {
          "--chat-keyboard-inset": `${viewport?.keyboardInset ?? 0}px`,
          // 보이는 높이를 알아낸 뒤에만 제한한다. 모르는 동안 임의 값으로 줄이지 않는다.
          ...(viewport ? { "--chat-visual-height": `${viewport.visualHeight}px` } : {}),
        } as React.CSSProperties
      }
    >
      <header className="chat-head">
        <span className="ai-label">주식 자료 대화</span>
        <h2 id={panelTitleId}>
          {headTarget
            ? `현재 대화 대상 · ${headTarget.name}(종목코드 ${headTarget.code})`
            : headCode
              ? `현재 대화 대상 · 종목코드 ${headCode}`
              : "종목을 고르지 않아도 질문할 수 있습니다"}
        </h2>
        {headCode ? (
          <a href={`/stocks/${headCode}`}>이 종목 상세 보기</a>
        ) : (
          <p>주식 자료를 이해하는 데 필요한 일반 개념을 물어보세요.</p>
        )}
      </header>

      <div className="chat-log">
        {messages.length === 0 && !pending && (
          <p className="chat-empty">
            예: 삼성전자의 최근 공시 5건을 DART 원문과 함께 보여줘 · 이 종목 최근 3개월 가격 흐름 알려줘 · 변동성이
            뭐야? · 가격 기간은 달력 1개월·3개월·12개월만 지원합니다.
          </p>
        )}
        {messages.map((message) => {
          if (message.kind === "question") {
            return (
              <p className="chat-question" key={message.id}>
                {message.text}
              </p>
            );
          }
          if (message.kind === "note") {
            return (
              <p className="chat-note" key={message.id}>
                {message.text}
              </p>
            );
          }
          return (
            <ChatAnswerView
              key={message.id}
              payload={message.payload}
              awaiting={awaitingSelection?.messageId === message.id ? awaitingSelection : null}
              busy={pending}
              onChoose={chooseCandidate}
            />
          );
        })}
        <div ref={logEndRef} />
      </div>

      <p className="chat-state" role="status" aria-live="polite">
        {pending ? "답변을 준비하는 중입니다…" : ""}
      </p>
      {errorMessage && (
        <p className="chat-error" role="alert">
          {errorMessage}
        </p>
      )}

      <form className="chat-form" onSubmit={submitQuestion}>
        <label className="visually-hidden" htmlFor="chat-question">
          질문
        </label>
        <textarea
          id="chat-question"
          ref={inputRef}
          value={question}
          maxLength={CHAT_MAX_QUESTION_LENGTH}
          rows={2}
          placeholder="종목의 공시나 주식 자료의 개념을 물어보세요."
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return;
            // 한글 조합 중의 Enter는 글자를 확정하는 입력이다. 그때 보내면 조합이 끊기고 오타가 남는다.
            // 일부 브라우저는 `isComposing`을 주지 않고 keyCode 229로만 알려 준다.
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
        />
        <button type="submit" disabled={pending || question.trim().length === 0}>
          {pending ? "전송 중…" : "질문 보내기"}
        </button>
        {pending && (
          <button type="button" onClick={cancelRequest}>
            요청 취소
          </button>
        )}
      </form>

      <footer className="chat-foot">
        <button type="button" onClick={clearConversation}>
          대화 지우기
        </button>
        <button type="button" onClick={onClose}>
          닫기
        </button>
        <span>대화는 이 탭에만 남고 새로고침·페이지 이동으로 끝납니다.</span>
      </footer>
    </div>
  );
}

function ChatAnswerView({
  payload,
  awaiting,
  busy,
  onChoose,
}: {
  payload: ChatAnswerPayload;
  awaiting: PendingSelection | null;
  busy: boolean;
  onChoose: (pending: PendingSelection, candidate: ChatTarget) => void;
}) {
  const filings = payload.verified?.filings ?? null;
  const price = payload.verified?.price ?? null;
  // 확인된 자료와 일반 설명은 기본으로 펼친다. 접는 것은 공시 전체 목록 같은 추가 근거뿐이다.
  const shownFilings = filings ? filings.items.slice(0, 2) : [];
  const foldedFilings = filings ? filings.items.slice(2) : [];

  return (
    <div className="chat-answer">
      {payload.verified && (
        <section className="chat-verified">
          <div className="chat-verified-head">
            <span className="chat-verified-label">{payload.verified.heading}</span>
            <span className="chat-prepared">준비 시각 {formatPreparedAt(payload.verified.preparedAt)}</span>
          </div>
          {payload.verified.target && (
            <p className="chat-target">
              {payload.verified.target.name} · 종목코드 {payload.verified.target.code} ·{" "}
              {payload.verified.target.market}
            </p>
          )}
          {/* 기간을 묻지 않은 질문에는 기간 요약을 만들지 않는다. 최근 확인 종가 하나만 보여 준다. */}
          {price?.kind === "latest" && (
            <div className="chat-price">
              <p className="chat-price-head">
                최근 확인 종가 · 가격 기준일 {formatCompactDate(price.baseDate)}
              </p>
              <ul className="chat-price-facts">
                <li>
                  종가 {formatNumber(price.close)}원
                  <span className="chat-price-basis">{formatCompactDate(price.quoteDate)} 거래일 종가</span>
                </li>
              </ul>
              <p className="chat-price-range">
                기준일은 이 서비스가 확인한 마지막 가격 날짜입니다. 지금 시각의 값이 아니며, 그 뒤의 거래는 담기지
                않습니다.
              </p>
              {price.endsBeforeBaseDate && (
                <p className="chat-price-short">
                  기준일에 거래일 자료가 없어 그보다 앞선 거래일 {formatCompactDate(price.quoteDate)}의 종가입니다.
                </p>
              )}
            </div>
          )}
          {price?.kind === "range" && (
            <div className="chat-price">
              <p className="chat-price-head">
                {price.periodLabel} 가격 요약 · 가격 기준일 {formatCompactDate(price.baseDate)}
              </p>
              <ul className="chat-price-facts">
                <li>
                  마지막 종가 {formatNumber(price.endClose)}원 (시작 종가 {formatNumber(price.startClose)}원)
                </li>
                <li>
                  구간 변화 {formatSigned(price.closeChange)}원 · {formatSigned(price.closeChangeRate, 2)}%
                  <span className="chat-price-basis">
                    {formatCompactDate(price.actualFrom)} 종가 → {formatCompactDate(price.actualTo)} 종가 기준
                  </span>
                </li>
                <li>
                  구간 고가 {formatNumber(price.highestHigh)}원 · 저가 {formatNumber(price.lowestLow)}원
                </li>
              </ul>
              {/* 요청한 달력 구간과 실제 확인된 거래일 구간을 따로 보여 준다. 같은 구간이 아니다. */}
              <p className="chat-price-range">
                요청 구간 {formatCompactDate(price.requestedFrom)}~{formatCompactDate(price.requestedTo)} · 확인된
                거래일 {formatCompactDate(price.actualFrom)}~{formatCompactDate(price.actualTo)} · 거래일{" "}
                {price.tradingDays}일
              </p>
              {price.baseDateClose !== null && (
                <p className="chat-price-quote">
                  기준일 종가 {formatNumber(price.baseDateClose)}원 (하루 시세에서 확인)
                </p>
              )}
              {price.limitedBySource && (
                <p className="chat-price-short">
                  요청 구간 앞부분은 확인된 자료가 없습니다. 확인된 자료는 {formatCompactDate(price.sourceFrom)}~
                  {formatCompactDate(price.sourceTo)}이며, 위 값은 확인된 구간만의 값입니다.
                </p>
              )}
              {price.endsBeforeRequestedTo && (
                <p className="chat-price-short">
                  기준일에 거래일 자료가 없어 마지막 거래일이 {formatCompactDate(price.actualTo)}입니다.
                </p>
              )}
            </div>
          )}
          {filings && (
            <>
              <p className="chat-filings-range">
                {formatCompactDate(filings.from)}~{formatCompactDate(filings.to)} 접수 공시 {filings.shownCount}건
                표시 (이 기간 전체 {filings.totalCount}건)
              </p>
              <ul className="chat-filings">
                {shownFilings.map((item) => (
                  <li key={item.receiptNo}>
                    <span className="chat-filing-date">{formatCompactDate(item.receiptDate)}</span>
                    <a href={item.documentUrl} target="_blank" rel="noreferrer">
                      {item.reportName}
                    </a>
                    <span className="chat-filing-filer">{item.filerName}</span>
                  </li>
                ))}
              </ul>
              {foldedFilings.length > 0 && (
                <details className="chat-more">
                  <summary>공시 {foldedFilings.length}건 더 보기</summary>
                  <ul className="chat-filings">
                    {foldedFilings.map((item) => (
                      <li key={item.receiptNo}>
                        <span className="chat-filing-date">{formatCompactDate(item.receiptDate)}</span>
                        <a href={item.documentUrl} target="_blank" rel="noreferrer">
                          {item.reportName}
                        </a>
                        <span className="chat-filing-filer">{item.filerName}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
          {payload.verified.notes.length > 0 && (
            <ul className="chat-notes">
              {payload.verified.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {payload.selection && (
        <section className="chat-selection">
          <p>{payload.selection.message}</p>
          <ul className="chat-candidates">
            {payload.selection.candidates.map((candidate) => (
              <li key={candidate.code}>
                {awaiting ? (
                  <button type="button" disabled={busy} onClick={() => onChoose(awaiting, candidate)}>
                    {candidate.name} · {candidate.code} · {candidate.market}
                  </button>
                ) : (
                  <span>
                    {candidate.name} · {candidate.code} · {candidate.market}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {payload.selection.truncated && (
            <p className="chat-truncated">
              찾은 종목이 더 있을 수 있어 {payload.selection.candidates.length}개만 보여 줍니다. 첫 후보가 정답이라는
              뜻은 아닙니다.
            </p>
          )}
        </section>
      )}

      {/* 일반 질문에는 빈 자료 카드를 만들지 않는다. 확인된 자료가 있을 때만 위 영역이 생긴다. */}
      {payload.general && (
        <section className="chat-general">
          <div className="chat-general-head">
            <span className="ai-label">{payload.general.heading}</span>
            <span className="chat-disclaimer">{payload.general.disclaimer}</span>
          </div>
          <p className="chat-summary">{payload.general.summary}</p>
          <ul>
            {payload.general.points.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
        </section>
      )}

      {payload.status && (
        <p className="chat-scope">
          {payload.status.message}
          {payload.status.nextActions.length > 0 && (
            <span className="chat-next">다음 행동: {payload.status.nextActions.join(" · ")}</span>
          )}
        </p>
      )}

      {/* 실제로 수행한 내역만 사용자 언어로 한 줄 표시한다. 함수명·호출 번호는 넣지 않는다. */}
      {payload.steps.length > 0 && <p className="chat-steps">수행 내역: {payload.steps.join(" → ")}</p>}
    </div>
  );
}
