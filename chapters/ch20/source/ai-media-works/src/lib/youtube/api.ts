import { seoulDay } from "../autoreply/policy";
import { requestSignal } from "../execution-budget";
import { getAccessToken } from "./auth";

/**
 * The transport helpers shared by the two YouTube clients in this project.
 *
 * authedGet is used by every lookup (channels.list, videos.list,
 * commentThreads.list, comments.list). authedPost exists for exactly one
 * method — comments.insert in src/lib/youtube/reply-client.ts — and is
 * imported nowhere else; src/app/bounded-write-surface.test.ts asserts that
 * statically so a second write path cannot appear unnoticed.
 */

export class SendWindowExpiredError extends Error {}

export const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

export async function authedGet(path: string, params: Record<string, string>): Promise<Response> {
  const accessToken = await getAccessToken();
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return fetch(url.toString(), {
    method: "GET",
    signal: requestSignal("youtube_read"),
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
}

/**
 * The access token goes in the Authorization header, never in the query
 * string, so it cannot end up in a proxy or server access log.
 */
export async function authedPost(
  path: string,
  params: Record<string, string>,
  body: unknown,
  expectedSendDay?: string,
): Promise<Response> {
  const accessToken = await getAccessToken();
  const url = new URL(`${YOUTUBE_API_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  if (expectedSendDay !== undefined && seoulDay(new Date()) !== expectedSendDay) throw new SendWindowExpiredError("Send window expired");
  return fetch(url.toString(), {
    method: "POST",
    signal: requestSignal("youtube_write"),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

interface YoutubeApiError {
  error?: { errors?: Array<{ reason?: string }>; code?: number };
}

/**
 * Reads only the short `reason` slug out of a YouTube error body (e.g.
 * "quotaExceeded", "commentsDisabled"). The body's human-readable `message`
 * is deliberately not read — it can echo request details back — and no
 * caller forwards this slug to the browser; it is used only to tell one
 * failure kind from another.
 */
export async function readApiErrorReason(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as YoutubeApiError;
    return body.error?.errors?.[0]?.reason ?? null;
  } catch {
    return null;
  }
}
