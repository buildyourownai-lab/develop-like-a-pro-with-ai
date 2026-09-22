import "server-only";

import { GoogleGenAI } from "@google/genai";

import { buildBriefingRequest, validateGroundedBriefing } from "./briefing";
import { recordChapter12Metric } from "./chapter12-metrics";
import { readGeminiKey, readGeminiModel } from "./env";
import { classifyGeminiCallError, type GeminiErrorKind } from "./gemini-error";
import { readCachedBriefing, writeCachedBriefing } from "./redis-briefing-cache";
import type { BriefingEvidencePacket, BriefingResult } from "./types";

export class GeminiBriefingError extends Error {
  constructor(
    message: string,
    readonly kind: GeminiErrorKind,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "GeminiBriefingError";
  }
}

/** 도구와 검색을 주지 않은 서버 전용 단발 호출. 반환 뒤에도 금지 표현과 근거 ID를 검사한다. */
export async function createGroundedBriefing(packet: BriefingEvidencePacket): Promise<BriefingResult> {
  const model = readGeminiModel();
  const cached = await readCachedBriefing(packet, model);
  if (cached) return { packet, ...cached };

  const client = new GoogleGenAI({ apiKey: readGeminiKey() });

  let responseText: string;
  let inputTokens = 0;
  let outputTokens = 0;
  let thoughtTokens = 0;
  let totalTokens = 0;
  const started = performance.now();
  let callRecorded = false;
  try {
    const response = await client.models.generateContent({
      model,
      ...buildBriefingRequest(packet),
    });
    inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
    outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
    thoughtTokens = response.usageMetadata?.thoughtsTokenCount ?? 0;
    totalTokens = response.usageMetadata?.totalTokenCount ?? inputTokens + outputTokens + thoughtTokens;
    recordChapter12Metric({
      service: "gemini",
      operation: model,
      durationMs: performance.now() - started,
      outcome: "network",
      inputTokens,
      outputTokens,
      thoughtTokens,
      totalTokens,
    });
    callRecorded = true;
    if (!response.text) throw new GeminiBriefingError("Gemini가 브리핑 내용을 반환하지 않았습니다.", "response_format");
    responseText = response.text;
  } catch (caught) {
    if (!callRecorded) {
      recordChapter12Metric({
        service: "gemini",
        operation: model,
        durationMs: performance.now() - started,
        outcome: "network",
      });
    }
    if (caught instanceof GeminiBriefingError) throw caught;
    throw new GeminiBriefingError("Gemini API 호출에 실패했습니다.", classifyGeminiCallError(caught), { cause: caught });
  }

  try {
    const parsed: unknown = JSON.parse(responseText);
    const result = {
      packet,
      briefing: validateGroundedBriefing(parsed, packet),
      model,
      generatedAt: new Date().toISOString(),
    };
    await writeCachedBriefing(packet, {
      briefing: result.briefing,
      model,
      generatedAt: result.generatedAt,
    }, model);
    return result;
  } catch (caught) {
    throw new GeminiBriefingError("Gemini 브리핑을 안전한 형식으로 만들지 못했습니다.", "response_format", { cause: caught });
  }
}
