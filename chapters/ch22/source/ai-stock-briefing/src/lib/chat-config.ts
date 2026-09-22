import "server-only";

import { chatEnabledFrom } from "./chat-contract";

/**
 * 22장 완성본은 대화 기능이 기본으로 켜진다.
 * 잠시 끄려면 서버 환경에 `CHAT_ENABLED=false`를 명시한다.
 */
export function isChatEnabled(): boolean {
  return chatEnabledFrom({ CHAT_ENABLED: process.env.CHAT_ENABLED });
}
