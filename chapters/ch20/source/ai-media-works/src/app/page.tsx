import { hasAutoReplyStoreConfig } from "@/lib/autoreply/supabase-store";
import HomeClient, { type ConfigStatus } from "./home-client";
import {
  PRODUCTION_PREVIEW_BLOCKED_MESSAGE,
  isProductionRuntime,
} from "@/lib/autoreply/runtime-guard";
import { hasYoutubeCredentialConfig } from "@/lib/youtube/auth";

/**
 * Server component: asks whether the credentials have a source configured at
 * all, then hands that to the client UI as a prop. This is NOT a "does it
 * actually work" check — a name being filled in does not mean any API call has
 * ever succeeded, so the client must never present this as "Live". Nothing
 * here reads, decodes, or exposes a secret value; hasYoutubeCredentialConfig
 * covers both accepted sources (a file path or an inline value), so a server
 * configured the deployment way does not report itself as unconfigured.
 */
function computeConfigStatus(): ConfigStatus {
  const youtubeConfigured = hasYoutubeCredentialConfig();
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_MODEL);
  if (youtubeConfigured && geminiConfigured) return "configured";
  // Only one side configured: the banner must not say "외부 호출 없음", because
  // whichever side is configured really can be called from this screen.
  if (youtubeConfigured || geminiConfigured) return "partial";
  return "unconfigured";
}

/**
 * The reader UI shows real viewers' comment text and the drafts written from
 * it. That belongs on the channel owner's own machine, so on a deployed server
 * this page renders a notice instead — matching the API routes it would call,
 * which are closed in production for the same reason.
 */
export default function Page() {
  if (isProductionRuntime()) {
    return (
      <main style={{ padding: "2rem", maxWidth: "40rem", lineHeight: 1.7 }}>
        <h1>배포된 서버입니다</h1>
        <p>{PRODUCTION_PREVIEW_BLOCKED_MESSAGE}</p>
        <p>
          이 서버는 승인해 둔 영상 1개에 대해 정해진 한도만큼 답글을 보내는 일만 합니다. 댓글
          원문과 초안은 여기에 저장되지 않습니다.
        </p>
      </main>
    );
  }
  return <HomeClient configStatus={computeConfigStatus()} storeConfigured={hasAutoReplyStoreConfig()} />;
}
