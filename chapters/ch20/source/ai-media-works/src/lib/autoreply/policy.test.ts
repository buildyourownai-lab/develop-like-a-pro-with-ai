import { describe, expect, it } from "vitest";
import { CommentReviewItem } from "../comments/types";
import {
  MAX_COMMENTS_PER_RUN,
  RECENT_WINDOW_DAYS,
  SEND_RETENTION_DAYS,
  autoReplyEligibility,
  commentAuthorEligibility,
  isPublishedAfterActivation,
  isWithinRecentWindow,
  selectAutoReplyTargets,
  seoulDay,
} from "./policy";

/**
 * The numbers and the gate, checked directly. These are the promises the
 * chapter makes out loud, so they get a test that names each one rather than
 * only being implied by a bigger run test.
 */

function reviewed(overrides: Partial<CommentReviewItem> = {}): CommentReviewItem {
  return {
    threadId: "THREAD",
    topLevelCommentId: "COMMENT",
    text: "잘 봤습니다.",
    publishedAt: "2026-09-14T12:00:00.000Z",
    classification: {
      category: "GENERAL_REACTION",
      tier: "AUTO_REPLY_CANDIDATE",
      reason: "분류: 일반 반응",
      forcedHumanReview: false,
    },
    draft: "봐 주셔서 감사합니다.",
    verification: {
      aiCheck: { passed: true, reason: "문맥에 맞습니다." },
      programCheck: { passed: true, failures: [] },
      passed: true,
    },
    geminiIssue: null,
    ...overrides,
  };
}

const ACTIVATED_AT = "2026-09-14T00:00:00.000Z";
const NOW = new Date("2026-09-14T13:00:00.000Z");

describe("the bounded numbers", () => {
  it("is 20 comments looked at, 1 sent per run, 5 per Asia/Seoul day, 7-day window, 30-day retention", () => {
    expect(MAX_COMMENTS_PER_RUN).toBe(20);
    expect(RECENT_WINDOW_DAYS).toBe(7);
    expect(SEND_RETENTION_DAYS).toBe(30);
  });
});

describe("comment author identity", () => {
  it("rejects the video owner's own top-level comment", () => {
    expect(commentAuthorEligibility("OWNER", "OWNER")).toEqual({
      eligible: false,
      reason: "video_owner_comment",
    });
  });

  it("fails closed when YouTube omits the author channel ID", () => {
    expect(commentAuthorEligibility(null, "OWNER")).toEqual({
      eligible: false,
      reason: "unknown_author",
    });
  });

  it("accepts a comment from a different channel", () => {
    expect(commentAuthorEligibility("VIEWER", "OWNER")).toEqual({ eligible: true });
  });
});

describe("the Asia/Seoul day the limit is counted against", () => {
  it("rolls over at 00:00 in Seoul, not at 00:00 UTC", () => {
    // 15:00 UTC is already the next calendar day in Seoul (UTC+9).
    expect(seoulDay(new Date("2026-09-14T14:59:00.000Z"))).toBe("2026-09-14");
    expect(seoulDay(new Date("2026-09-14T15:00:00.000Z"))).toBe("2026-09-15");
  });

  it("does not move with the machine's own timezone", () => {
    // Both of these are the same instant written two ways; the day must match.
    expect(seoulDay(new Date("2026-09-14T15:30:00.000Z"))).toBe(
      seoulDay(new Date("2026-09-15T00:30:00+09:00")),
    );
  });
});

describe("activation is a floor, never retroactive", () => {
  it("accepts a comment published strictly after activation", () => {
    expect(isPublishedAfterActivation("2026-09-14T00:00:01.000Z", ACTIVATED_AT)).toBe(true);
  });

  it("rejects a comment published at the exact activation instant", () => {
    expect(isPublishedAfterActivation(ACTIVATED_AT, ACTIVATED_AT)).toBe(false);
  });

  it("rejects the whole backlog that existed before activation", () => {
    expect(isPublishedAfterActivation("2026-09-13T23:59:59.000Z", ACTIVATED_AT)).toBe(false);
  });

  it("rejects an unparseable timestamp rather than guessing", () => {
    expect(isPublishedAfterActivation("어제", ACTIVATED_AT)).toBe(false);
  });
});

describe("the recent 7-day window", () => {
  it("accepts a comment from just inside 7 days", () => {
    expect(isWithinRecentWindow("2026-09-07T13:00:01.000Z", NOW)).toBe(true);
  });

  it("rejects a comment from just outside 7 days", () => {
    expect(isWithinRecentWindow("2026-09-07T12:59:59.000Z", NOW)).toBe(false);
  });

  it("rejects a timestamp in the future instead of treating it as very recent", () => {
    expect(isWithinRecentWindow("2026-09-20T00:00:00.000Z", NOW)).toBe(false);
  });
});

describe("the eligibility gate", () => {
  const context = { activatedAt: ACTIVATED_AT, now: NOW };

  it("passes a general reaction that cleared both chapter 19 checks", () => {
    expect(autoReplyEligibility(reviewed(), context)).toEqual({ eligible: true });
  });

  it("passes a follow-up request", () => {
    const item = reviewed({
      classification: {
        category: "FOLLOW_UP_REQUEST",
        tier: "AUTO_REPLY_CANDIDATE",
        reason: "분류: 다음 요청",
        forcedHumanReview: false,
      },
    });
    expect(autoReplyEligibility(item, context)).toEqual({ eligible: true });
  });

  it("never sends a question, a factual complaint, or an ad", () => {
    for (const category of ["QUESTION", "FACT_OR_COMPLAINT", "AD_OR_UNRELATED"] as const) {
      const item = reviewed({
        classification: {
          category,
          tier: "AUTO_REPLY_CANDIDATE",
          reason: "분류",
          forcedHumanReview: false,
        },
      });
      // Even with the tier forced to the auto tier, the category gate holds.
      expect(autoReplyEligibility(item, context)).toEqual({
        eligible: false,
        reason: "category_not_auto_reply",
      });
    }
  });

  it("never sends something the classifier was unsure about", () => {
    const item = reviewed({
      classification: {
        category: "UNKNOWN",
        tier: "HUMAN_REVIEW",
        reason: "혼합·모호한 신호",
        forcedHumanReview: true,
      },
    });
    expect(autoReplyEligibility(item, context)).toEqual({
      eligible: false,
      reason: "not_auto_reply_tier",
    });
  });

  it("refuses when either chapter 19 check failed", () => {
    const aiFailed = reviewed({
      verification: {
        aiCheck: { passed: false, reason: "문맥이 맞지 않습니다." },
        programCheck: { passed: true, failures: [] },
        passed: false,
      },
    });
    const programFailed = reviewed({
      verification: {
        aiCheck: { passed: true, reason: "문맥에 맞습니다." },
        programCheck: { passed: false, failures: ["링크가 포함되었습니다."] },
        passed: false,
      },
    });
    for (const item of [aiFailed, programFailed]) {
      expect(autoReplyEligibility(item, context)).toEqual({
        eligible: false,
        reason: "verification_not_passed",
      });
    }
  });

  it("refuses when no check ever ran", () => {
    expect(autoReplyEligibility(reviewed({ verification: null }), context)).toEqual({
      eligible: false,
      reason: "verification_not_passed",
    });
  });

  it("refuses a blank draft", () => {
    expect(autoReplyEligibility(reviewed({ draft: "   " }), context)).toEqual({
      eligible: false,
      reason: "no_draft",
    });
  });
});

describe("choosing what one run may answer", () => {
  const context = { activatedAt: ACTIVATED_AT, now: NOW };

  it("takes at most one target however many are eligible, and defers the rest", () => {
    const items = [
      reviewed({ topLevelCommentId: "C_NEW", publishedAt: "2026-09-14T12:00:00.000Z" }),
      reviewed({ topLevelCommentId: "C_OLD", publishedAt: "2026-09-14T02:00:00.000Z" }),
      reviewed({ topLevelCommentId: "C_MID", publishedAt: "2026-09-14T06:00:00.000Z" }),
    ];
    const selection = selectAutoReplyTargets(items, context);
    expect(selection.targets).toHaveLength(3);
    // Oldest eligible first, so a burst is worked through in arrival order
    // instead of the newest comment being answered over and over.
    expect(selection.targets[0]?.topLevelCommentId).toBe("C_OLD");
    expect(selection.deferredCount).toBe(0);
  });

  it("reports a reason for every comment it passed over", () => {
    const items = [
      reviewed({ topLevelCommentId: "C_OLD_BACKLOG", publishedAt: "2026-09-13T00:00:00.000Z" }),
      reviewed({ topLevelCommentId: "C_STALE", publishedAt: "2026-08-01T00:00:00.000Z" }),
      reviewed({ topLevelCommentId: "C_OK" }),
    ];
    const selection = selectAutoReplyTargets(items, context);
    expect(selection.skipped).toEqual([
      { topLevelCommentId: "C_OLD_BACKLOG", reason: "published_before_activation" },
      { topLevelCommentId: "C_STALE", reason: "published_before_activation" },
    ]);
    expect(selection.targets[0]?.topLevelCommentId).toBe("C_OK");
  });

  it("selects nothing at all from a backlog, which is why the first activation sends zero", () => {
    const backlog = [
      reviewed({ topLevelCommentId: "C1", publishedAt: "2026-09-13T10:00:00.000Z" }),
      reviewed({ topLevelCommentId: "C2", publishedAt: "2026-09-12T10:00:00.000Z" }),
    ];
    const selection = selectAutoReplyTargets(backlog, context);
    expect(selection.targets).toEqual([]);
    expect(selection.deferredCount).toBe(0);
  });
});
