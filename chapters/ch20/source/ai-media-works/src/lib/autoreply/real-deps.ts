import { createRealGeminiClient, hasGeminiConfig } from "../gemini/real-client";
import { createRealReplyClient } from "../youtube/reply-client";
import { createRealYoutubeClient } from "../youtube/real-client";
import { AutoReplyDeps } from "./runner";
import { createSupabaseAutoReplyStore, hasAutoReplyStoreConfig } from "./supabase-store";

/**
 * The one place the real clients get wired together.
 *
 * The runner takes all four as arguments, so this file is the only thing a test
 * has to avoid in order to be certain it cannot reach YouTube, Gemini, or
 * Supabase. Nothing here makes a call; building a client is just holding on to
 * a key or a path.
 */
export function createAutoReplyDeps(): AutoReplyDeps {
  return {
    store: createSupabaseAutoReplyStore(),
    youtube: createRealYoutubeClient(),
    replies: createRealReplyClient(),
    gemini: createRealGeminiClient(),
    now: () => new Date(),
  };
}

export const AUTO_REPLY_CONFIG_MESSAGE =
  "자동답글에 필요한 서버 설정이 아직 없습니다. .env.local의 이름을 다시 확인하세요.";

/**
 * Checked before a run starts rather than per comment: without the state store
 * or without Gemini not one comment could be handled, and a run that started
 * anyway could reserve a slot it can never use.
 */
export function hasAutoReplyConfig(): boolean {
  return hasAutoReplyStoreConfig() && hasGeminiConfig();
}
