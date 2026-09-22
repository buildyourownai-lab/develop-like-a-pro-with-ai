import { describe, expect, it } from "vitest";
import { MAX_COMMENTS_PER_REQUEST, validateReviewRequest } from "./request-validation";

function comment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    threadId: "thread-1",
    topLevelCommentId: "comment-1",
    text: "잘 봤습니다.",
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateReviewRequest", () => {
  it("accepts a single valid comment", () => {
    const result = validateReviewRequest([comment()]);
    expect(result.ok).toBe(true);
  });

  it("accepts exactly the maximum of 20 comments", () => {
    const comments = Array.from({ length: MAX_COMMENTS_PER_REQUEST }, (_, i) =>
      comment({ threadId: `thread-${i}`, topLevelCommentId: `comment-${i}` }),
    );
    const result = validateReviewRequest(comments);
    expect(result.ok).toBe(true);
  });

  it("rejects zero comments", () => {
    const result = validateReviewRequest([]);
    expect(result.ok).toBe(false);
  });

  it("rejects more than 20 comments", () => {
    const comments = Array.from({ length: MAX_COMMENTS_PER_REQUEST + 1 }, (_, i) =>
      comment({ threadId: `thread-${i}`, topLevelCommentId: `comment-${i}` }),
    );
    const result = validateReviewRequest(comments);
    expect(result.ok).toBe(false);
  });

  it("rejects a non-array body", () => {
    expect(validateReviewRequest("not an array").ok).toBe(false);
    expect(validateReviewRequest(null).ok).toBe(false);
    expect(validateReviewRequest({}).ok).toBe(false);
  });

  it("rejects an item missing required fields", () => {
    const result = validateReviewRequest([{ threadId: "t1" }]);
    expect(result.ok).toBe(false);
  });

  it("rejects excessively long comment text", () => {
    const result = validateReviewRequest([comment({ text: "가".repeat(10_001) })]);
    expect(result.ok).toBe(false);
  });

  it("rejects an excessively long comment ID", () => {
    const result = validateReviewRequest([comment({ topLevelCommentId: "x".repeat(300) })]);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty ID", () => {
    const result = validateReviewRequest([comment({ threadId: "" })]);
    expect(result.ok).toBe(false);
  });

  it("rejects an invalid publishedAt value", () => {
    const result = validateReviewRequest([comment({ publishedAt: "not-a-date" })]);
    expect(result.ok).toBe(false);
  });

  it("rejects an empty publishedAt value", () => {
    const result = validateReviewRequest([comment({ publishedAt: "" })]);
    expect(result.ok).toBe(false);
  });

  it("rejects duplicate comment IDs within the same batch", () => {
    const result = validateReviewRequest([
      comment({ threadId: "t1", topLevelCommentId: "dup" }),
      comment({ threadId: "t2", topLevelCommentId: "dup" }),
    ]);
    expect(result.ok).toBe(false);
  });
});
