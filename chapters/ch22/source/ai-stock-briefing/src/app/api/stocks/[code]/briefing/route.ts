import { NextResponse } from "next/server";

import { collectBriefingEvidence, InsufficientEvidenceError } from "@/lib/briefing-evidence";
import { InvalidBriefingError } from "@/lib/briefing";
import { GeminiBriefingError, createGroundedBriefing } from "@/lib/gemini";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  let stage: "evidence" | "generation" = "evidence";
  try {
    const packet = await collectBriefingEvidence(decodeURIComponent((await params).code));
    stage = "generation";
    return NextResponse.json(await createGroundedBriefing(packet));
  } catch (caught) {
    if (caught instanceof InsufficientEvidenceError) {
      return NextResponse.json({ error: caught.message, kind: "insufficient_evidence" }, { status: 422 });
    }
    if (caught instanceof InvalidBriefingError || caught instanceof GeminiBriefingError) {
      const kind = caught instanceof GeminiBriefingError ? caught.kind : "response_format";
      if (kind === "quota") {
        return NextResponse.json(
          {
            error: "Gemini 호출 한도에 도달했습니다. 한도가 갱신된 뒤 다시 시도해 주세요. 반복해서 눌러도 성공하지 않습니다.",
            code: "GEMINI_QUOTA_EXCEEDED",
            retryable: false,
          },
          { status: 429 }
        );
      }
      const detail = {
        authentication: {
          error: "Gemini 인증 설정을 확인하는 중입니다. 관리자에게 문의해 주세요.",
          code: "GEMINI_AUTHENTICATION_FAILED",
        },
        model: {
          error: "현재 설정된 Gemini 모델을 사용할 수 없습니다. 관리자에게 문의해 주세요.",
          code: "GEMINI_MODEL_UNAVAILABLE",
        },
        timeout: {
          error: "Gemini 응답 시간이 초과되었습니다. 잠시 뒤 다시 시도해 주세요.",
          code: "GEMINI_TIMEOUT",
        },
        call: {
          error: "Gemini 연결에 실패했습니다. 잠시 뒤 다시 시도해 주세요.",
          code: "GEMINI_CALL_FAILED",
        },
        response_format: {
          error: "AI 응답이 근거 경계와 안전한 형식을 지키지 않아 표시하지 않았습니다.",
          code: "GEMINI_RESPONSE_REJECTED",
        },
      }[kind];
      return NextResponse.json(
        {
          ...detail,
          retryable: kind === "call" || kind === "timeout",
        },
        { status: 502 }
      );
    }
    const message = caught instanceof Error ? caught.message : "";
    const cause = caught instanceof Error ? caught.cause : undefined;
    console.error("briefing_unclassified_error", {
      stage,
      name: caught instanceof Error ? caught.name : typeof caught,
      code: typeof caught === "object" && caught !== null && "code" in caught ? String(caught.code) : undefined,
      status: typeof caught === "object" && caught !== null && "status" in caught ? Number(caught.status) : undefined,
      causeName: cause instanceof Error ? cause.name : undefined,
      causeCode: typeof cause === "object" && cause !== null && "code" in cause ? String(cause.code) : undefined,
    });
    const source = /OpenDART|공시|고유번호/.test(message) ? "OpenDART" : "금융위원회";
    return NextResponse.json(
      {
        error: `${source} 근거 자료를 모으지 못해 브리핑을 만들 수 없습니다.`,
        kind: source === "OpenDART" ? "dart_error" : "fsc_error",
      },
      { status: 502 }
    );
  }
}
