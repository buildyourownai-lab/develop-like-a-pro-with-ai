import "server-only";

import { GoogleGenAI } from "@google/genai";

import { buildChatToolRequest, readChatModelTurn, type SendChatTurn } from "./chat-answer";
import { readGeminiKey, readGeminiModel } from "./env";
import { classifyGeminiCallError, type GeminiErrorKind } from "./gemini-error";

export class ChatModelError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "ChatModelError";
  }
}

/**
 * 기존 서버 Gemini 연결·모델 설정을 그대로 쓰는 단발 호출이다.
 * 허용한 세 기능 선언만 넘기고, 어느 기능을 부를지는 모델이 정한다.
 * 문자열을 읽어 기능 호출처럼 흉내내지 않는다.
 * API Key는 서버 환경변수에서만 읽고, SDK 재시도는 1회 시도로 묶어 자동 재시도를 만들지 않는다.
 *
 * 응답은 `functionCalls` 편의 목록만 꺼내지 않고 **candidate content 객체를 그대로** 넘긴다.
 * 공식 문서(GenerateContent function calling / thought signatures, 2026-09-14 확인)에 따르면
 * 모델이 준 part에는 `thoughtSignature`처럼 뜻을 알 수 없는 값이 붙을 수 있고, 다음 기능 응답
 * 요청에서 그 part를 순서·값 그대로 다시 보내야 한다. 여기서 parts를 다시 만들면 그 값이 사라진다.
 * 서명을 만들어 내거나 검증을 건너뛰지 않고, 받은 것을 그대로 돌려보낼 뿐이다.
 */
export const sendChatTurnWithGemini: SendChatTurn = async (contents, options) => {
  const model = readGeminiModel();
  let client: GoogleGenAI;
  try {
    client = new GoogleGenAI({ apiKey: readGeminiKey() });
  } catch (caught) {
    throw new ChatModelError("AI 인증 설정이 준비되지 않았습니다.", "authentication", { cause: caught });
  }

  try {
    const response = await client.models.generateContent({
      model,
      ...buildChatToolRequest(contents, options),
    });

    const turn = readChatModelTurn(response);
    if (turn.calls.length === 0 && turn.text === null) {
      throw new ChatModelError("AI가 답변 내용을 반환하지 않았습니다.", "response_format");
    }
    return { turn, model };
  } catch (caught) {
    if (caught instanceof ChatModelError) throw caught;
    throw new ChatModelError("AI 호출에 실패했습니다.", classifyGeminiCallError(caught), { cause: caught });
  }
};
