import { ApiError } from "@google/genai";
import { describe, expect, it } from "vitest";
import { FakeGeminiClient } from "../gemini/__fixtures__/fake-client";
import { GeminiConfigMissingError } from "../gemini/errors";
import { GeminiSchemaError } from "../gemini/schema";
import { TEST_COMMENTS } from "./__fixtures__/test-comments";
import { reviewComment } from "./pipeline";
import { FetchedComment } from "./types";

function comment(text: string): FetchedComment {
  return {
    threadId: "thread-1",
    topLevelCommentId: "comment-1",
    text: text,
    publishedAt: "2026-01-01T00:00:00Z",
  };
}

describe("reviewComment — no external API is called in this suite", () => {
  it("단순 응원은 자동답글 후보가 되고 두 검사를 통과한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.classification.category).toBe("GENERAL_REACTION");
    expect(result.classification.tier).toBe("AUTO_REPLY_CANDIDATE");
    expect(result.draft).toBe("응원 감사합니다!");
    expect(result.verification?.passed).toBe(true);
    expect(gemini.classifyCalls).toEqual([TEST_COMMENTS.simpleCheer]);
    expect(gemini.draftCalls).toHaveLength(1);
    expect(gemini.contextCheckCalls).toHaveLength(1);
  });

  it("분류 사유에는 한국어 종류 이름이 들어가고, 내부 enum 이름은 노출되지 않는다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.classification.reason).toContain("일반 반응");
    expect(result.classification.reason).not.toContain("GENERAL_REACTION");
  });

  it("후속 요청도 자동답글 후보가 된다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "FOLLOW_UP_REQUEST", mixedSignals: false }),
      draft: async () => ({ draft: "의견 감사합니다. 다음에 참고할게요." }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.followUpRequest), gemini);

    expect(result.classification.tier).toBe("AUTO_REPLY_CANDIDATE");
    expect(result.verification?.passed).toBe(true);
  });

  it("질문은 사람 확인으로 내려가고 초안을 만들지 않는다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "QUESTION", mixedSignals: false }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.question), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.draft).toBeNull();
    expect(gemini.draftCalls).toHaveLength(0);
  });

  it("사실 지적·불만은 사람 확인으로 내려간다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "FACT_OR_COMPLAINT", mixedSignals: false }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.factComplaint), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(gemini.draftCalls).toHaveLength(0);
  });

  it("광고·무관한 내용은 답하지 않음으로 내려가고 초안을 만들지 않는다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "AD_OR_UNRELATED", mixedSignals: false }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.ad), gemini);

    expect(result.classification.tier).toBe("NO_REPLY");
    expect(gemini.draftCalls).toHaveLength(0);
  });

  it("질문이 섞인 응원은 QUESTION으로 분류돼도 사람 확인으로 남는다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "QUESTION", mixedSignals: false }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.mixedCheerQuestion), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
  });

  it("AI가 mixedSignals만 표시해도 자동답글 후보에서 사람 확인으로 강제 전환한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: true }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.mixedCheerQuestion), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.classification.forcedHumanReview).toBe(true);
    expect(gemini.draftCalls).toHaveLength(0);
  });

  it("댓글 속 지시를 AI가 잘못 따라가 초안에 링크를 넣어도 프로그램 검사가 후보에서 제외한다", async () => {
    const gemini = new FakeGeminiClient({
      // An AI that mis-reads the injected instruction as an ordinary cheer comment.
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      // ...and an AI that actually followed the embedded instruction and put a link in.
      draft: async () => ({ draft: "네! http://malicious.example 여기로 와주세요" }),
      // An AI context check that (wrongly) approves it — must not be trusted alone.
      contextCheck: async () => ({ passed: true, reason: "괜찮아 보입니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.promptInjection), gemini);

    expect(gemini.classifyCalls).toEqual([TEST_COMMENTS.promptInjection]);
    expect(result.verification?.programCheck.passed).toBe(false);
    expect(result.verification?.programCheck.failures.join(" ")).toMatch(/링크/);
    expect(result.verification?.passed).toBe(false);
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
  });

  it("개인정보로 보이는 댓글은 Gemini를 호출하지 않고 사람 확인으로 남긴다", async () => {
    const gemini = new FakeGeminiClient({});

    const result = await reviewComment(comment(TEST_COMMENTS.personalInfo), gemini);

    expect(gemini.classifyCalls).toHaveLength(0);
    expect(result.classification.category).toBe("UNKNOWN");
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
  });

  it("빈 문장은 Gemini를 호출하지 않고 사람 확인으로 남긴다", async () => {
    const gemini = new FakeGeminiClient({});

    const result = await reviewComment(comment(TEST_COMMENTS.blank), gemini);

    expect(gemini.classifyCalls).toHaveLength(0);
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
  });

  it("너무 긴 문장은 자동답글 후보 자격을 잃고 사람 확인으로 내려간다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.overlyLong), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.classification.forcedHumanReview).toBe(true);
    expect(gemini.draftCalls).toHaveLength(0);
  });

  it("AI가 정해진 다섯 종류 밖의 값을 반환하면 사람 확인으로 남긴다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "NOT_A_REAL_CATEGORY", mixedSignals: false }),
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.classification.category).toBe("UNKNOWN");
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
  });

  it("분류 호출이 실패하면 사람 확인으로 남기고 classification 단계 issue를 기록한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => {
        throw new ApiError({ message: "unauthorized, key=sk-live-abc123", status: 401 });
      },
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "auth_error" });
    expect(JSON.stringify(result)).not.toContain("sk-live-abc123");
  });

  it("초안 생성이 실패하면 사람 확인으로 전환하고 초안은 없으며 draft 단계 issue를 기록한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => {
        throw new ApiError({ message: "rate limited", status: 429 });
      },
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.draft).toBeNull();
    expect(result.geminiIssue).toEqual({ stage: "draft", reason: "quota_exceeded" });
  });

  it("AI 검사 호출이 실패하면 통과로 처리하지 않고 사람 확인으로 전환하며 context_check 단계 issue를 기록한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => {
        throw new TypeError("fetch failed");
      },
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.verification?.passed).toBe(false);
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.geminiIssue).toEqual({ stage: "context_check", reason: "network_error" });
  });

  it("서버에 GEMINI_API_KEY/GEMINI_MODEL이 없으면 config_missing으로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => {
        throw new GeminiConfigMissingError("GEMINI_API_KEY is not set on the server.");
      },
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "config_missing" });
  });

  it("존재하지 않는 모델·잘못된 요청(400/404)은 model_or_request_error로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => {
        throw new ApiError({ message: "model not found", status: 404 });
      },
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "model_or_request_error" });
  });

  it("그 외 알 수 없는 오류는 service_error로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => {
        throw new Error("something odd");
      },
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "service_error" });
  });

  it("빈 초안(malformed) 응답은 invalid_response로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "   " }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.draft).toBeNull();
    expect(result.geminiIssue).toEqual({ stage: "draft", reason: "invalid_response" });
  });

  it("AI가 정해진 다섯 종류 밖의 값을 반환하면 invalid_response로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "NOT_A_REAL_CATEGORY", mixedSignals: false }),
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "invalid_response" });
  });

  it("빈 댓글·개인정보 같은 로컬 안전장치는 Gemini 실패로 기록하지 않는다 (geminiIssue는 null)", async () => {
    const gemini = new FakeGeminiClient({});

    const blank = await reviewComment(comment(TEST_COMMENTS.blank), gemini);
    const personalInfo = await reviewComment(comment(TEST_COMMENTS.personalInfo), gemini);

    expect(blank.classification.tier).toBe("HUMAN_REVIEW");
    expect(blank.geminiIssue).toBeNull();
    expect(personalInfo.classification.tier).toBe("HUMAN_REVIEW");
    expect(personalInfo.geminiIssue).toBeNull();
  });

  it("프로그램 검사만 실패한 경우(Gemini 호출은 모두 성공)는 geminiIssue가 null이다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "네! http://malicious.example 여기로 와주세요" }),
      contextCheck: async () => ({ passed: true, reason: "괜찮아 보입니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.promptInjection), gemini);

    expect(result.verification?.programCheck.passed).toBe(false);
    expect(result.classification.tier).toBe("HUMAN_REVIEW");
    expect(result.geminiIssue).toBeNull();
  });

  it("성공 fixture는 geminiIssue가 null이다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => ({ category: "GENERAL_REACTION", mixedSignals: false }),
      draft: async () => ({ draft: "응원 감사합니다!" }),
      contextCheck: async () => ({ passed: true, reason: "적절합니다" }),
    });

    const result = await reviewComment(comment(TEST_COMMENTS.simpleCheer), gemini);

    expect(result.geminiIssue).toBeNull();
  });

  it("GeminiSchemaError(malformed 응답)는 어느 단계에서든 invalid_response로 분류한다", async () => {
    const gemini = new FakeGeminiClient({
      classify: async () => {
        throw new GeminiSchemaError("category 값이 정해진 다섯 종류 중 하나가 아닙니다");
      },
    });

    const result = await reviewComment(comment("아무 댓글"), gemini);

    expect(result.geminiIssue).toEqual({ stage: "classification", reason: "invalid_response" });
  });
});
