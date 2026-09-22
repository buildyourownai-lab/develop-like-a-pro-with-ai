/**
 * Local, non-AI checks that run before a comment is ever sent to Gemini.
 * These exist so that an empty comment, an oversized comment, or a comment
 * that looks like it is soliciting personal contact never reaches the model,
 * regardless of what the model would have said about it.
 */

/** Comments longer than this are never eligible for an auto-reply draft. */
export const MAX_LENGTH_FOR_AUTO_REPLY = 280;

const PII_KEYWORD_PATTERN =
  /전화\s*번호|연락처|이메일|메일\s*주소|카카오\s*톡|카톡\s*(아이디|친구)?|인스타(그램)?\s*(dm|디엠)?|개인\s*정보/i;

/**
 * A phone number or e-mail address written out as a value. Shared with the
 * draft program check (src/lib/comments/draft-policy.ts) so the incoming
 * comment and the outgoing draft are held to one definition of "this is
 * contact information" — two copies could drift apart and let a draft carry a
 * pattern the comment side already rejects.
 */
export const CONTACT_VALUE_PATTERN =
  /(01[016789][-.\s]?\d{3,4}[-.\s]?\d{4})|([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

export function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

export function isOverAutoReplyLength(text: string): boolean {
  return text.trim().length > MAX_LENGTH_FOR_AUTO_REPLY;
}

/** True when the comment contains, or is asking the reader to share, contact-style personal information. */
export function looksLikePersonalInfo(text: string): boolean {
  return PII_KEYWORD_PATTERN.test(text) || CONTACT_VALUE_PATTERN.test(text);
}
