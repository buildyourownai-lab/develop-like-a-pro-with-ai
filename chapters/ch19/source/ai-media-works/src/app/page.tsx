import HomeClient, { type ConfigStatus } from "./home-client";

/**
 * Server component: reads env vars to see whether the two credential
 * paths/keys are present, then hands that to the client UI as a prop. This
 * is NOT a "does it actually work" check — the env vars being set does not
 * mean any API call has ever succeeded, so the client must never present
 * this as "Live". This never reads or exposes any secret value — only
 * whether the paths/keys are present.
 */
function computeConfigStatus(): ConfigStatus {
  const youtubeConfigured = Boolean(
    process.env.YOUTUBE_OAUTH_CLIENT_JSON_PATH && process.env.YOUTUBE_OAUTH_COMMENT_READ_TOKEN_PATH,
  );
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  if (youtubeConfigured && geminiConfigured) return "configured";
  // Only one side configured: the banner must not say "외부 호출 없음", because
  // whichever side is configured really can be called from this screen.
  if (youtubeConfigured || geminiConfigured) return "partial";
  return "unconfigured";
}

export default function Page() {
  return <HomeClient configStatus={computeConfigStatus()} />;
}
