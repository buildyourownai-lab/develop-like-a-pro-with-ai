import { describe, expect, it } from "vitest";
import { MAX_DRAFT_LENGTH, runProgramCheck } from "./draft-policy";

describe("runProgramCheck", () => {
  it("passes a short, plain draft", () => {
    const result = runProgramCheck("응원 감사합니다! 다음 영상도 기대해주세요.", "잘 봤습니다.");
    expect(result.passed).toBe(true);
    expect(result.failures).toHaveLength(0);
  });

  it("fails when the draft is longer than the limit", () => {
    const longDraft = "감".repeat(MAX_DRAFT_LENGTH + 1);
    const result = runProgramCheck(longDraft, "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/자를 넘습니다/);
  });

  it("fails when the draft has more than two sentences", () => {
    const result = runProgramCheck("감사합니다. 응원할게요. 또 올게요.", "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/문장을 넘습니다/);
  });

  it("fails when the draft contains a link", () => {
    const result = runProgramCheck("자세한 내용은 http://example.com 참고하세요.", "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/링크/);
  });

  it("fails when the draft contains an account handle", () => {
    const result = runProgramCheck("제 계정 @creator_id 로 문의해주세요.", "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/계정/);
  });

  it("fails when the draft contains a phone number or email", () => {
    const result = runProgramCheck("010-1234-5678로 연락주세요.", "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/개인정보/);
  });

  it("fails when the draft promises a schedule or reward", () => {
    const result = runProgramCheck("다음 주에 반드시 올려드릴게요. 보상도 드립니다.", "원문");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/약속/);
  });

  it("fails when the draft is a verbatim copy of the original comment", () => {
    const result = runProgramCheck("잘 봤습니다.", "잘 봤습니다.");
    expect(result.passed).toBe(false);
    expect(result.failures.join(" ")).toMatch(/복사/);
  });

  it("fails when the draft is empty", () => {
    const result = runProgramCheck("   ", "원문");
    expect(result.passed).toBe(false);
  });
});
