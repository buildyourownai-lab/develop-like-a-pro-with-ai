/**
 * Korean display label for a video's privacyStatus, shared by the reader UI
 * so the raw YouTube API enum value never reaches the browser as-is. Closed
 * by design: any value this app does not recognize (a future YouTube
 * privacy state, or a malformed response that slipped past schema
 * validation) falls to "확인 필요" rather than echoing the raw string.
 */
export type YoutubePrivacyDisplay = "공개" | "일부 공개" | "확인 필요";

const PRIVACY_DISPLAY_LABEL: Record<string, YoutubePrivacyDisplay> = {
  public: "공개",
  unlisted: "일부 공개",
};

export function privacyDisplayLabel(privacyStatus: string): YoutubePrivacyDisplay {
  return PRIVACY_DISPLAY_LABEL[privacyStatus] ?? "확인 필요";
}
