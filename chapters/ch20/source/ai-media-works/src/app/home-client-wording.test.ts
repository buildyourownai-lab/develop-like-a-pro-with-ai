import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A static text guard on the reader UI's own wording, in the same spirit as
 * bounded-write-surface.test.ts: this project has no component-rendering test
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

  it("tells the reader to check either the configured file paths or the deployment JSON settings, and the README, for a credential error", () => {
    // Both credentials now load from a path OR an inline JSON value (see
    // src/lib/youtube/auth.ts), so guidance naming only the two *_PATH
    // variables would send a deployed reader to settings they never set.
    expect(SOURCE).toContain(
      "내 컴퓨터에서 실행 중이면 설정된 두 파일 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)의 파일이 있는지와 그 내용이 올바른 JSON인지 확인하세요",
    );
    expect(SOURCE).toContain(
      "배포한 서버라면 JSON 값을 그대로 넣는 설정(YOUTUBE_OAUTH_CLIENT_JSON, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_JSON)의 값을 확인하세요",
    );
    expect(SOURCE).toContain("자격증명 하나당 파일 경로와 JSON 값 중 하나만 설정해야 하며, 자세한 절차는 README를 보세요");
    // The path-only wording this replaced must not come back.
    expect(SOURCE).not.toContain(
      "설정된 두 경로(YOUTUBE_OAUTH_CLIENT_JSON_PATH, YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH)와 README를 확인하세요",
    );
  });

  it("states the credential error itself as an auth-setting problem, not as a file-only one", () => {
    // The headline message must match the guidance above, which covers a file
    // path AND a deployment JSON value. Saying "인증 파일" told a deployed
    // reader to look for a file that does not exist on that server.
    const credentialMessagePattern = /message: "YouTube 인증 설정을 읽거나 형식을 확인하지 못했습니다\."/g;
    // credential_file_invalid, ownership_credential_file_invalid, and the
    // video-error map each carry this message.
    expect((SOURCE.match(credentialMessagePattern) ?? []).length).toBe(3);
    expect(SOURCE).not.toContain("설정된 인증 파일을 읽거나");
    expect(SOURCE).not.toContain("인증 파일");
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

describe("the approval flow chapter 20 adds", () => {
  it("no longer claims the project cannot write a comment, and says what the writes are", () => {
    // This claim was true for chapter 19 and is false now — a screen that still
    // said it would be the most misleading sentence in the project.
    expect(SOURCE).not.toContain("보내기 버튼이나 댓글 작성 API가 없습니다");
    expect(SOURCE).not.toContain("로컬 미리보기 · YouTube 전송 없음");
    expect(SOURCE).toContain("댓글을 쓰는 호출은 4단계의");
    expect(SOURCE).toContain("5단계의 예약 실행뿐이고");
    expect(SOURCE).toContain("올라간 답글은 이 프로그램이 지울 수 없습니다");
  });

  it("separates the read-only preview, the one-off approval, and the schedule into their own steps", () => {
    expect(SOURCE).toContain("3. 분류 · 처리 수준 · 답글 초안 미리보기");
    expect(SOURCE).toContain("이 단계는 읽기만 합니다");
    expect(SOURCE).toContain("4. 답글 1개 준비 · 사람 승인 · 전송 (예약 실행과 별개)");
    expect(SOURCE).toContain("5. 예약 실행 자동답글 (기본값: 꺼짐)");
    // The two chapter 20 decisions must not read as one switch.
    expect(SOURCE).toContain("5단계의 예약 실행을 한 번도 켜지");
    expect(SOURCE).toContain("이것은 4단계와 다른 결정입니다");
  });

  it("states the default and target where the schedule is", () => {
    expect(SOURCE).toContain("실행 시간 안에서 조건에 맞는 댓글을 순서대로 처리합니다");
    expect(SOURCE).toContain("자동답글 기본값 꺼짐 · 승인한 영상만 처리");
  });

  it("prepares the exact sentence first and says preparing sends nothing but may store the target", () => {
    expect(SOURCE).toContain("보낼 문장 준비하기 (아직 보내지 않음)");
    expect(SOURCE).toContain("준비는 아무것도 보내지 않습니다");
    // The one write preparing can make is stated where the button is, because
    // the screen used to claim the opposite.
    expect(SOURCE).toContain("이때 채널·영상·기준 시각이 저장됩니다. 예약 실행은 켜지지 않습니다");
    expect(SOURCE).toContain("이 영상을 답글 대상으로 저장했습니다");
    // And the old false claim that the server re-drafts at send time is gone.
    expect(SOURCE).not.toContain("보낼 문구는 서버가 다시 만듭니다");
  });

  it("shows the prepared sentence as the exact text that will be published", () => {
    expect(SOURCE).toContain("이 문장이 그대로 올라갑니다");
    expect(SOURCE).toContain("{prepared.draft}");
    expect(SOURCE).toContain("위 문장을 승인하고 답글 1개 보내기");
    // A stale approval is refused by the server, so the screen says so rather
    // than letting a person press a button that cannot work.
    expect(SOURCE).toContain("승인 정보는 10분이 지나면 만료되고");
  });

  it("sends the two ids and the token — never the sentence itself", () => {
    const sendBody = SOURCE.match(/async function approveAndSend\([\s\S]*?\n {2}\}/)![0];
    const requestLiteral = sendBody.match(
      /autoReplyRequest<AutoReplyActionResponse>\("send", \{([\s\S]*?)\}\)/,
    )![1]!;
    expect(requestLiteral).toContain("videoId: videoCheck.videoId,");
    expect(requestLiteral).toContain("topLevelCommentId: prepared.topLevelCommentId,");
    // The token, not the text: the server reads the sentence out of the signed
    // payload. If the request could carry text, approving a comment would turn
    // into "post this for me" and every server-side check would be optional.
    expect(requestLiteral).toContain("approvalToken: prepared.approvalToken,");
    expect(requestLiteral).not.toMatch(/\b(text|draft)\s*:/);
  });

  it("asks for confirmation first, because a published reply cannot be taken back here", () => {
    expect(SOURCE).toContain("window.confirm(");
    expect(SOURCE).toContain("실제 YouTube에 답글 1개가 올라갑니다");
  });

  it("offers preparing on an auto-reply candidate of the video on screen, with the schedule irrelevant", () => {
    expect(SOURCE).toContain('item.classification.tier === "AUTO_REPLY_CANDIDATE" && (');
    expect(SOURCE).toContain("4단계 승인 대상으로 선택");
    const gate = SOURCE.match(/const canPrepareApproval =[\s\S]*?;\n/)![0];
    expect(gate).toContain("canLoadComments");
    expect(gate).toContain("approvalTarget !== null");
    expect(gate).toContain("!storedOtherVideo");
    expect(gate).toContain("!haltedOnUnknown");
    // The schedule being off is not a statement about this one reply, so it must
    // not appear in the gate at all.
    expect(gate).not.toContain("enabled");
    expect(SOURCE).toContain("disabled={!canPrepareApproval || prepareBusy || sendBusy}");
    expect(SOURCE).toContain("disabled={!canApproveSend || sendBusy}");
  });

  it("says a stop leaves the manual approval available, and a halt does not", () => {
    expect(SOURCE).toContain("끄기는 예약 실행만 멈춥니다");
    expect(SOURCE).toContain("4단계의 사람 승인 전송은 그 뒤에도 할 수 있습니다");
    expect(SOURCE).toContain("사람이 승인해도 보내지 않습니다");
  });

  it("names the next step for every closed skip reason, including the baseline floor", () => {
    for (const reason of [
      "invalid_published_at",
      "published_before_activation",
      "older_than_recent_window",
      "not_auto_reply_tier",
      "category_not_auto_reply",
      "verification_not_passed",
      "no_draft",
    ]) {
      expect(SOURCE).toContain(`${reason}: {`);
    }
    expect(SOURCE).toContain("답글 대상으로 저장한 시각보다 먼저 올라온 댓글입니다");
    expect(SOURCE).toContain("저장 시각 이후에 새로 올라온 댓글을 골라 다시 준비하세요");
  });

  it("keeps raw ids and full records behind a details block, with the status first", () => {
    expect(SOURCE).toContain("<summary>이 승인의 id와 기준 시각</summary>");
    expect(SOURCE).toContain("<summary>전송 기록과 id 자세히 보기</summary>");
    // The summary line a person reads first must be a count, not a list of ids.
    expect(SOURCE).toContain("전송 기록 ${autoStatus.recentSends.length}건이 있습니다.");
  });

  it("says what the stored record does and does not contain", () => {
    expect(SOURCE).toContain("기록에는 댓글 내용·작성자·답글 내용이 없습니다");
    expect(SOURCE).toContain("30일이 지난 기록은 다음 예약 호출 때 삭제됩니다");
  });

  it("explains a stop with no result as the server's own halt, not a retry", () => {
    expect(SOURCE).toContain("전송 결과를 확인하지 못해 스스로 멈췄습니다. 사람이 실제 결과를 확인해야 하며, 이 화면에서는 중단을 해제할 수 없습니다.");
    expect(SOURCE).toContain("RESULT_UNKNOWN: \"결과 확인 못함 · 자동답글 멈춤\"");
  });
});
