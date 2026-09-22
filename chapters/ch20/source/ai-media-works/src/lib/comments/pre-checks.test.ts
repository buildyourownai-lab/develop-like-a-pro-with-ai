import { describe, expect, it } from "vitest";
import { isBlank, isOverAutoReplyLength, looksLikePersonalInfo } from "./pre-checks";

describe("isBlank", () => {
  it("treats empty and whitespace-only text as blank", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   \n\t")).toBe(true);
    expect(isBlank("잘 봤습니다.")).toBe(false);
  });
});

describe("isOverAutoReplyLength", () => {
  it("flags text over the auto-reply length limit", () => {
    expect(isOverAutoReplyLength("짧은 댓글")).toBe(false);
    expect(isOverAutoReplyLength("가".repeat(281))).toBe(true);
  });
});

describe("looksLikePersonalInfo", () => {
  it("flags a request to contact by phone even without a literal number", () => {
    expect(looksLikePersonalInfo("제 전화번호로 연락해주세요.")).toBe(true);
  });

  it("flags a literal phone number or email", () => {
    expect(looksLikePersonalInfo("010-1234-5678로 연락주세요.")).toBe(true);
    expect(looksLikePersonalInfo("me@example.com으로 메일 주세요.")).toBe(true);
  });

  it("does not flag an ordinary comment", () => {
    expect(looksLikePersonalInfo("영상 잘 봤습니다. 다음 편도 기대할게요.")).toBe(false);
  });
});
