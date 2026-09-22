import { CONTACT_VALUE_PATTERN } from "./pre-checks";
import { ProgramCheckResult } from "./types";

export const MAX_DRAFT_LENGTH = 100;
export const MAX_DRAFT_SENTENCES = 2;

const URL_PATTERN = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|kr|co\.kr)\b/i;
const HANDLE_OR_ACCOUNT_PATTERN =
  /@[a-zA-Z0-9._]{2,}|계정\s*(이름|아이디|명)|아이디[:는]|디엠|dm\s*주세요/i;
const PROMISE_KEYWORD_PATTERN =
  /약속|보장|장담|반드시|무조건|확실히|수익|보상|환불드|드리겠습니다|드릴게요|다음\s*(주|달|화)에\s*(만들|올리|공개)/;

function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const segments = trimmed
    .split(/[.!?]+|[다요]\s*(?=\s|$)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return Math.max(segments.length, 1);
}

/**
 * Program-side gate on a generated draft. This runs independently of the
 * AI context check — either one failing is enough to keep the draft out of
 * the auto-reply candidate pool.
 */
export function runProgramCheck(
  draft: string,
  originalComment: string,
): ProgramCheckResult {
  const failures: string[] = [];
  const trimmedDraft = draft.trim();

  if (trimmedDraft.length === 0) {
    failures.push("초안이 비어 있습니다.");
  }
  if (trimmedDraft.length > MAX_DRAFT_LENGTH) {
    failures.push(`초안이 ${MAX_DRAFT_LENGTH}자를 넘습니다.`);
  }
  if (countSentences(trimmedDraft) > MAX_DRAFT_SENTENCES) {
    failures.push(`초안이 ${MAX_DRAFT_SENTENCES}문장을 넘습니다.`);
  }
  if (URL_PATTERN.test(trimmedDraft)) {
    failures.push("초안에 링크로 보이는 내용이 있습니다.");
  }
  if (HANDLE_OR_ACCOUNT_PATTERN.test(trimmedDraft)) {
    failures.push("초안에 계정명·아이디로 보이는 내용이 있습니다.");
  }
  if (CONTACT_VALUE_PATTERN.test(trimmedDraft)) {
    failures.push("초안에 개인정보로 보이는 내용이 있습니다.");
  }
  if (PROMISE_KEYWORD_PATTERN.test(trimmedDraft)) {
    failures.push("초안이 일정·수익·보상을 약속하는 것으로 보입니다.");
  }
  if (
    trimmedDraft.length > 0 &&
    trimmedDraft === originalComment.trim()
  ) {
    failures.push("초안이 원문을 그대로 복사했습니다.");
  }

  return { passed: failures.length === 0, failures };
}
