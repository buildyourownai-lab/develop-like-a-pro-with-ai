import { jsonResponse } from "../http";

/**
 * What chapter 19 may and may not do once this app is deployed.
 *
 * Chapter 19's screens exist to put a real viewer's comment text, and a draft
 * written from it, in front of the person running the channel on their own
 * machine. That is fine on 127.0.0.1. On a public URL the same screens would
 * hand a stranger other people's comments, so in production those routes and
 * that page are closed — the deployed app only ever does the bounded chapter
 * 20 job, which never returns comment text at all.
 *
 * This is a runtime check on purpose, and not a build-time flag: a flag can be
 * flipped by whoever deploys, whereas NODE_ENV === "production" is what Next
 * sets for `next build` output and `next start`.
 */

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

export const PRODUCTION_PREVIEW_BLOCKED_MESSAGE =
  "배포된 서버에서는 댓글 원문 미리보기를 사용할 수 없습니다. 원문 확인과 초안 검토는 내 컴퓨터에서만 합니다.";

/**
 * Returns a 404 response when running in production, otherwise null so the
 * route continues. 404 rather than 403: on a deployed server these routes
 * simply do not exist as far as a caller is concerned, and a 403 would confirm
 * that a comment-reading endpoint is there to be attacked.
 */
export function blockPreviewInProduction(): Response | null {
  if (!isProductionRuntime()) {
    return null;
  }
  return jsonResponse({ error: PRODUCTION_PREVIEW_BLOCKED_MESSAGE }, 404);
}
