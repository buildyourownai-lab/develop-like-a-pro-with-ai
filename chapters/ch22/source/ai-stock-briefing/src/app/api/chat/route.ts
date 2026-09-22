import { NextResponse } from "next/server";

import { ChatSelectionRejectedError, InvalidChatAnswerError, runChatTurn } from "@/lib/chat-answer";
import { ChatBudgetExceededError, ChatCallBudget } from "@/lib/chat-budget";
import { isChatEnabled } from "@/lib/chat-config";
import { InvalidChatRequestError, validateChatAskRequest } from "@/lib/chat-contract";
import { chatLookups } from "@/lib/chat-lookups";
import { ChatModelError, sendChatTurnWithGemini } from "@/lib/chat-model";

export const runtime = "nodejs";

const MODEL_ERROR_DETAIL = {
  quota: {
    error: "AI 호출 한도에 도달했습니다. 한도가 갱신된 뒤 다시 시도해 주세요.",
    code: "CHAT_MODEL_QUOTA_EXCEEDED",
    status: 429,
    retryable: false,
  },
  authentication: {
    error: "AI 인증 설정을 확인하는 중입니다. 관리자에게 문의해 주세요.",
    code: "CHAT_MODEL_AUTHENTICATION_FAILED",
    status: 502,
    retryable: false,
  },
  model: {
    error: "현재 설정된 AI 모델을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
    code: "CHAT_MODEL_UNAVAILABLE",
    status: 502,
    retryable: false,
  },
  timeout: {
    error: "AI 응답 시간이 초과되었습니다. 다시 질문해 주세요.",
    code: "CHAT_MODEL_TIMEOUT",
    status: 504,
    retryable: true,
  },
  call: {
    error: "AI 연결에 실패했습니다. 다시 질문해 주세요.",
    code: "CHAT_MODEL_CALL_FAILED",
    status: 502,
    retryable: true,
  },
  response_format: {
    error: "AI 답변이 안전한 형식과 범위를 지키지 않아 표시하지 않았습니다.",
    code: "CHAT_MODEL_RESPONSE_REJECTED",
    status: 502,
    retryable: false,
  },
} as const;

const BUDGET_ERROR_DETAIL = {
  time: { code: "CHAT_TIME_LIMIT", status: 504 },
  model_calls: { code: "CHAT_MODEL_CALL_LIMIT", status: 429 },
  lookups: { code: "CHAT_LOOKUP_LIMIT", status: 429 },
} as const;

export async function POST(request: Request) {
  // 명시적으로 끈 동안에는 직접 호출도 모델까지 가지 않는다.
  if (!isChatEnabled()) {
    return NextResponse.json(
      { error: "대화 기능이 꺼져 있습니다.", code: "CHAT_DISABLED", retryable: false },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다.", code: "CHAT_REQUEST_INVALID", retryable: false },
      { status: 400 }
    );
  }

  try {
    const ask = validateChatAskRequest(body);
    // 한 질문의 상한은 이 예산 객체 하나가 지킨다(모델 3회·조회 4회·전체 30초).
    const budget = new ChatCallBudget();

    // 호출 수는 응답 본문에 넣지 않는다. 화면에는 수행 내역만 사용자 언어로 나간다.
    const { payload } = await runChatTurn(ask, {
      sendTurn: sendChatTurnWithGemini,
      lookups: chatLookups,
      budget,
      requestId: crypto.randomUUID(),
    });
    return NextResponse.json(payload);
  } catch (caught) {
    if (caught instanceof InvalidChatRequestError) {
      return NextResponse.json(
        { error: caught.message, code: "CHAT_REQUEST_INVALID", retryable: false },
        { status: 400 }
      );
    }
    // 후보 재검증 실패는 잘못된 요청으로 끝낸다. 확인하지 못한 종목으로 조회를 이어가지 않는다.
    if (caught instanceof ChatSelectionRejectedError) {
      return NextResponse.json(
        { error: caught.message, code: "CHAT_SELECTION_INVALID", retryable: false },
        { status: 400 }
      );
    }
    if (caught instanceof ChatBudgetExceededError) {
      const detail = BUDGET_ERROR_DETAIL[caught.reason];
      return NextResponse.json(
        { error: caught.message, code: detail.code, retryable: false },
        { status: detail.status }
      );
    }
    const kind = caught instanceof ChatModelError ? caught.kind : caught instanceof InvalidChatAnswerError ? "response_format" : null;
    if (kind) {
      const { status, ...detail } = MODEL_ERROR_DETAIL[kind];
      return NextResponse.json(detail, { status });
    }
    // 질문 원문과 내부 값은 기록하지 않는다.
    console.error("chat_unclassified_error", { name: caught instanceof Error ? caught.name : typeof caught });
    return NextResponse.json(
      { error: "답변을 만들지 못했습니다. 다시 질문해 주세요.", code: "CHAT_FAILED", retryable: true },
      { status: 502 }
    );
  }
}
