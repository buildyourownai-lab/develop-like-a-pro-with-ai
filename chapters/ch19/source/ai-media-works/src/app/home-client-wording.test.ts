import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A static text guard on the reader UI's own wording, in the same spirit as
 * no-write-surface.test.ts: this project has no component-rendering test
 * setup (no jsdom/testing-library), so these checks read the source text
 * directly rather than mounting the component.
 */
const SOURCE = readFileSync(join(__dirname, "home-client.tsx"), "utf8");

describe("reader UI wording", () => {
  it("labels the post-videos.list field as progression, not comment access, and states only privacy confirmation", () => {
    expect(SOURCE).toContain("댓글 조회 진행 가능 여부");
    expect(SOURCE).toContain("공개 범위 확인됨 — 다음 단계 진행 가능");
    // Must not claim comments are readable/enabled from videos.list alone —
    // commentThreads.list can still report comments disabled afterward.
    expect(SOURCE).not.toContain("댓글 읽기 가능 여부");
    expect(SOURCE).not.toMatch(/읽기 가능["'`]/);
  });

  it("uses '일부 공개' with a space consistently, never the unspaced '일부공개'", () => {
    expect(SOURCE).not.toContain("일부공개");
    expect(SOURCE).toContain("일부 공개");
  });

  it("uses '공개 범위' with a space consistently, never the unspaced '공개범위'", () => {
    expect(SOURCE).not.toContain("공개범위");
    expect(SOURCE).toContain("공개 범위");
  });

  it("displays the video's privacy status through the closed Korean map, never the raw API enum", () => {
    expect(SOURCE).toContain("privacyDisplayLabel(videoCheck.privacyStatus)");
    expect(SOURCE).not.toContain("{videoCheck.privacyStatus}");
  });

  it("keeps the (unlisted) hint only on actionable next-step guidance, not on the plain status text", () => {
    expect(SOURCE).toContain("일부 공개(unlisted) 상태의 다른 시험 영상을 선택하세요");
    expect(SOURCE).toContain("채널 일치와 공개(또는 일부 공개) 상태가 모두 확인된 뒤에 읽을 수 있습니다");
  });

  it("explains an absent draft by current tier and generation/check failure, not by category ('이 종류는')", () => {
    expect(SOURCE).not.toContain("이 종류는");
    expect(SOURCE).toContain("초안 생성·검사에 실패");
    expect(SOURCE).toMatch(/현재 처리 수준은 \{TIER_LABEL\[item\.classification\.tier\]\}/);
  });

  it("gives scope_insufficient guidance that points at the exact comment-read setup command and continuation to Console check", () => {
    expect(SOURCE).toContain("npm run setup:youtube-comment-read -- <18장 client_secret*.json 경로>를 다시 실행해 새 Token을 발급하고");
    expect(SOURCE).toContain("계속되면 Google Cloud Console에서 데이터 액세스 설정을 확인하세요");
    // Must never suggest chapter 18's readonly/status-change token as a working substitute.
    expect(SOURCE).not.toMatch(/먼저 YOUTUBE_OAUTH_.*TOKEN_PATH가 18장의 상태변경 Token/);
  });

  it("tells the reader to check the two configured paths and the README for a credential file error", () => {
    expect(SOURCE).toContain(
      "설정된 두 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)와 README를 확인하세요",
    );
  });

  it("includes the required client JSON argument placeholder in every auth-renewal command shown to the reader", () => {
    const renewalCommandPattern = /npm run setup:youtube-comment-read -- <18장 client_secret\*\.json 경로>를 다시 실행해 새 Token을 발급하고/g;
    const matches = SOURCE.match(renewalCommandPattern) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
    expect(SOURCE).not.toMatch(/npm run setup:youtube-comment-read를 다시 실행해 인증을 갱신하세요/);
    expect(SOURCE).not.toMatch(/npm run setup:youtube-comment-read를 다시 실행해 새 Token을 발급하고(?!.*<18장)/);
    expect(SOURCE).not.toContain("setup:youtube-readonly");
  });

  it("instructs the reader to use the setup:youtube-comment-read command with new COMMENT_READ_TOKEN_PATH and never reuse chapter 18's status-change token", () => {
    // The UI must guide readers to run the correct setup command with the new
    // token path, and must never suggest that chapter 18's readonly/status-change
    // token (YOUTUBE_OAUTH_TOKEN_PATH) will work as a substitute.
    expect(SOURCE).toContain("setup:youtube-comment-read");
    expect(SOURCE).toContain("YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH");
    expect(SOURCE).toContain(".secrets/youtube-comment-read-oauth.json");
    expect(SOURCE).not.toContain("setup:youtube-readonly");
    // This check is already covered at line 52-54, but repeat here for clarity:
    // the UI must never suggest the chapter 18 token as a working substitute.
    expect(SOURCE).not.toMatch(/먼저 YOUTUBE_OAUTH_.*TOKEN_PATH가 18장의 상태변경 Token/);
  });

  it("shows a prominent warning that a partial review result is not a full Gemini success", () => {
    expect(SOURCE).toContain('reviewStatus === "partial"');
    expect(SOURCE).toContain("실제 Gemini");
    expect(SOURCE).toContain("성공이 아닙니다");
  });

  it("gives one actionable next step per closed Gemini issue reason, with no raw error text", () => {
    for (const reason of [
      "config_missing",
      "auth_error",
      "quota_exceeded",
      "model_or_request_error",
      "network_error",
      "invalid_response",
      "service_error",
    ]) {
      expect(SOURCE).toContain(`${reason}:`);
    }
    expect(SOURCE).toContain(".env.local에 GEMINI_API_KEY와 GEMINI_MODEL을 설정한 뒤 서버를 재시작하세요");
    expect(SOURCE).not.toContain(".env에 GEMINI_API_KEY");
    expect(SOURCE).toContain("GEMINI_API_KEY의 권한");
    expect(SOURCE).toContain("사용량 한도를 확인한 뒤 잠시 후 다시 시도하세요");
    expect(SOURCE).toContain("GEMINI_MODEL 값이 지원되는 모델 이름인지 확인하세요");
    // Guards against a raw SDK/error message ever being interpolated into the UI.
    expect(SOURCE).not.toMatch(/\{.*error\.message/);
    expect(SOURCE).not.toMatch(/\{.*\.stack\}/);
  });

  it("shows both the fixed message and its next-action step for a known /api/review error reason, never the raw server message", () => {
    // The lookup itself must pick the closed-set reason's message over the
    // server's raw body.message whenever a known reason is present.
    expect(SOURCE).toContain("const issueInfo = body.reason ? GEMINI_ISSUE_INFO[body.reason] : undefined;");
    expect(SOURCE).toContain("setReviewError(issueInfo?.message ?? body.message ?? \"분류·초안 요청이 실패했습니다.\");");
    expect(SOURCE).toContain("setReviewErrorNextAction(issueInfo?.nextAction ?? null);");
    // The rendered next-action line must actually be shown next to the error message.
    expect(SOURCE).toContain("{reviewErrorNextAction && <p className=\"status-line\">{reviewErrorNextAction}</p>}");
  });

  it("marks each downgraded review card with its Gemini issue stage and reason label, not raw error text", () => {
    expect(SOURCE).toContain("item.geminiIssue &&");
    expect(SOURCE).toContain("GEMINI_ISSUE_STAGE_LABEL[item.geminiIssue.stage]");
    expect(SOURCE).toContain("GEMINI_ISSUE_INFO[item.geminiIssue.reason]?.label");
  });

  it("resets the full downstream review state as one unit whenever a video check or comments load starts, so a stale partial/error warning can never survive into the next batch", () => {
    const resetHelperMatch = SOURCE.match(/function resetReviewState\(\) \{[\s\S]*?\n {2}\}/);
    expect(resetHelperMatch).not.toBeNull();
    const resetHelper = resetHelperMatch![0];
    // The helper itself must clear every piece of downstream review state together.
    expect(resetHelper).toContain("setItems(null)");
    expect(resetHelper).toContain("setReviewStatus(null)");
    expect(resetHelper).toContain("setReviewError(null)");
    expect(resetHelper).toContain("setReviewErrorNextAction(null)");

    const checkVideoBody = SOURCE.match(/async function checkVideo\(\) \{[\s\S]*?\n {2}\}/)![0];
    const loadCommentsBody = SOURCE.match(/async function loadComments\(\) \{[\s\S]*?\n {2}\}/)![0];
    const reviewCommentsBody = SOURCE.match(/async function reviewComments\(\) \{[\s\S]*?\n {2}\}/)![0];
    for (const body of [checkVideoBody, loadCommentsBody, reviewCommentsBody]) {
      expect(body).toContain("resetReviewState();");
    }
    // Neither reset caller may set only `items` while leaving the review status/error
    // fields from a prior batch behind — that's the exact bug this helper prevents.
    expect(checkVideoBody).not.toContain("setItems(null);");
    expect(loadCommentsBody).not.toContain("setItems(null);");
  });
});
