import { describe, expect, it } from "vitest";
import { isAutoReplyEligibleCategory, tierForCategory } from "./tier-policy";

describe("tierForCategory", () => {
  it("maps the five fixed categories to exactly three tiers", () => {
    expect(tierForCategory("GENERAL_REACTION")).toBe("AUTO_REPLY_CANDIDATE");
    expect(tierForCategory("FOLLOW_UP_REQUEST")).toBe("AUTO_REPLY_CANDIDATE");
    expect(tierForCategory("QUESTION")).toBe("HUMAN_REVIEW");
    expect(tierForCategory("FACT_OR_COMPLAINT")).toBe("HUMAN_REVIEW");
    expect(tierForCategory("AD_OR_UNRELATED")).toBe("NO_REPLY");
  });

  it("agrees with isAutoReplyEligibleCategory", () => {
    expect(isAutoReplyEligibleCategory("GENERAL_REACTION")).toBe(true);
    expect(isAutoReplyEligibleCategory("QUESTION")).toBe(false);
    expect(isAutoReplyEligibleCategory("AD_OR_UNRELATED")).toBe(false);
  });
});
