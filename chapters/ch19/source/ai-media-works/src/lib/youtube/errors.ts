/**
 * Typed errors thrown by the real YouTube client so a lookup failure can be
 * classified by type (instanceof), not by matching substrings of
 * error.message. Message-matching is brittle — a wording tweak silently
 * stops being classified — and these messages may embed a local file path,
 * so the classifier must not need to inspect them at all.
 */
export class YoutubeConfigMissingError extends Error {}
export class YoutubeCredentialFileError extends Error {}
export class YoutubeScopeInsufficientError extends Error {}
export class YoutubeAuthError extends Error {}
export class YoutubeQuotaExceededError extends Error {}
export class YoutubeInvalidResponseError extends Error {}

/**
 * videos.list / channels.list answered with an empty items array. That is the
 * API's normal way of saying "there is no such video" or "this account has no
 * channel" — a real outcome the reader can act on (fix the URL, or connect the
 * account that owns the channel), not a malformed response. Kept as its own
 * type so it is never reported as "응답 형식을 확인하지 못했습니다", which would
 * send the reader looking for a bug that isn't there.
 */
export class YoutubeVideoNotFoundError extends Error {}
export class YoutubeChannelNotFoundError extends Error {}
