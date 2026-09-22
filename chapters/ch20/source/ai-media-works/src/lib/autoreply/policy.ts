import { CommentCategory, CommentReviewItem } from "../comments/types";

/**
 * Every number and rule that bounds chapter 20's automation, in one file so
 * the limits can be read (and tested) without reading the runner.
 *
 * None of these are advisory. The runner enforces all of them, and the
 * database enforces duplicate prevention inside an atomic statement —
 * the two together are what make a bounded promise true rather than hoped for.
 */

/** The clock used for historical daily statistics, fixed regardless of server timezone. */
export const SEOUL_TIME_ZONE = "Asia/Seoul";

/**
 * How many top-level comments one run ever looks at. This mirrors the
 * maxResults=20 that src/lib/youtube/real-client.ts sends to
 * commentThreads.list: one run reads exactly one page.
 *
 * It does NOT mean the newest 20 are all this app can ever reach. A run that
 * stops on a page with more behind it saves the API's page cursor, and the next
 * run starts from there — so a video with 200 comments in scope is worked
 * through over several runs instead of the older 180 being invisible forever.
 */
export const MAX_COMMENTS_PER_RUN = 20;


/** Comments older than this are never auto-replied to, even if never seen before. */
export const RECENT_WINDOW_DAYS = 7;
const RECENT_WINDOW_MS = RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * How long a claim row stays "fresh". This matches the 10-minute scheduled
 * interval, but note what it does NOT mean: an expired lock is never on its
 * own a licence to send again. The claim row itself is the duplicate guard
 * and it is permanent; expiry only marks a claim as worth reconciling
 * against comments.list.
 */
export const CLAIM_LOCK_SECONDS = 600;

/** Diagnostic deadline only. Expiry NEVER permits takeover of an unresolved send. */
export const SEND_LEASE_SECONDS = 120;

/**
 * How long an approval stays valid. A person approves an exact sentence; if
 * they leave the page open for hours, the comment they approved a reply to may
 * have been edited or deleted, so the approval expires and the screen has to
 * show a fresh preview before anything can be sent.
 */
export const APPROVAL_TTL_SECONDS = 600;

/** Nothing about a send is kept longer than this. */
export const SEND_RETENTION_DAYS = 30;

/**
 * The only two categories that may ever be answered automatically. Questions,
 * factual corrections/complaints, ads, and anything the classifier was not
 * sure about are excluded here as well as by the tier table in
 * src/lib/comments/tier-policy.ts — two independent gates, not one.
 */
export const AUTO_REPLY_CATEGORIES: readonly CommentCategory[] = [
  "GENERAL_REACTION",
  "FOLLOW_UP_REQUEST",
];

export function isAutoReplyCategory(category: string): category is CommentCategory {
  return (AUTO_REPLY_CATEGORIES as readonly string[]).includes(category);
}

// en-CA formats as YYYY-MM-DD, which is also the shape the send_day date
// column takes, so the same string is used for the counter key and the SQL
// argument with no reformatting in between.
const SEOUL_DAY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: SEOUL_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Asia/Seoul calendar day an instant falls on, as YYYY-MM-DD. */
export function seoulDay(at: Date): string {
  return SEOUL_DAY_FORMAT.format(at);
}

/** The instant `days` days before `at`, used for the retention cutoff. */
export function daysBefore(at: Date, days: number): Date {
  return new Date(at.getTime() - days * 24 * 60 * 60 * 1000);
}

export const SKIP_REASONS = [
  "video_owner_comment",
  "unknown_author",
  "invalid_published_at",
  "published_before_activation",
  "older_than_recent_window",
  "not_auto_reply_tier",
  "category_not_auto_reply",
  "verification_not_passed",
  "no_draft",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

export type Eligibility = { eligible: true } | { eligible: false; reason: SkipReason };

/** Missing author identity fails closed; the video owner never receives an automatic reply. */
export function commentAuthorEligibility(
  authorChannelId: string | null | undefined,
  videoOwnerChannelId: string,
): Eligibility {
  if (!authorChannelId) return { eligible: false, reason: "unknown_author" };
  if (authorChannelId === videoOwnerChannelId) {
    return { eligible: false, reason: "video_owner_comment" };
  }
  return { eligible: true };
}

/**
 * Only comments published strictly after the baseline instant count. Preparing
 * a target is never retroactive: the backlog that existed at that moment stays
 * untouched forever, which is why preparing can only ever send zero replies.
 * The baseline is decided once and preserved, so stopping and resuming does not
 * move it — the comments that arrived while the schedule was off stay in scope.
 */
export function isPublishedAfterActivation(publishedAt: string, activatedAt: string): boolean {
  const published = Date.parse(publishedAt);
  const activated = Date.parse(activatedAt);
  if (!Number.isFinite(published) || !Number.isFinite(activated)) return false;
  return published > activated;
}

export function isWithinRecentWindow(publishedAt: string, now: Date): boolean {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return false;
  // A timestamp in the future is not "recent" — it is unusable, and treating
  // it as recent would let a bad clock or a spoofed value bypass the window.
  if (published > now.getTime()) return false;
  return now.getTime() - published <= RECENT_WINDOW_MS;
}

/**
 * The full gate one reviewed comment must pass to be answered automatically.
 * Checked in a fixed order so the reported reason is the first thing wrong,
 * and every branch returns a reason from the closed SKIP_REASONS set.
 */
export function autoReplyEligibility(
  item: CommentReviewItem,
  context: { activatedAt: string; now: Date },
): Eligibility {
  if (!Number.isFinite(Date.parse(item.publishedAt))) {
    return { eligible: false, reason: "invalid_published_at" };
  }
  if (!isPublishedAfterActivation(item.publishedAt, context.activatedAt)) {
    return { eligible: false, reason: "published_before_activation" };
  }
  if (!isWithinRecentWindow(item.publishedAt, context.now)) {
    return { eligible: false, reason: "older_than_recent_window" };
  }
  if (item.classification.tier !== "AUTO_REPLY_CANDIDATE") {
    return { eligible: false, reason: "not_auto_reply_tier" };
  }
  if (!isAutoReplyCategory(item.classification.category)) {
    return { eligible: false, reason: "category_not_auto_reply" };
  }
  // Both chapter 19 checks — the AI context check and the program check —
  // must have passed. verification.passed is their AND, and a null
  // verification means neither ever ran.
  if (item.verification === null || !item.verification.passed) {
    return { eligible: false, reason: "verification_not_passed" };
  }
  if (item.draft === null || item.draft.trim().length === 0) {
    return { eligible: false, reason: "no_draft" };
  }
  return { eligible: true };
}

export interface SkippedComment {
  topLevelCommentId: string;
  reason: SkipReason;
}

export interface AutoReplySelection {
  /** Eligible entries, oldest first. */
  targets: CommentReviewItem[];
  /** Eligible comments beyond the per-run cap — deliberately left for a later run. */
  deferredCount: number;
  skipped: SkippedComment[];
}

/**
 * Picks what this run may answer. Comments arrive newest-first from
 * commentThreads.list; the oldest eligible one is answered first so a burst
 * of comments is worked through in the order it arrived rather than
 * repeatedly answering whatever is newest.
 */
export function selectAutoReplyTargets(
  items: readonly CommentReviewItem[],
  context: { activatedAt: string; now: Date },
): AutoReplySelection {
  const eligible: CommentReviewItem[] = [];
  const skipped: SkippedComment[] = [];

  for (const item of items) {
    const verdict = autoReplyEligibility(item, context);
    if (verdict.eligible) {
      eligible.push(item);
    } else {
      skipped.push({ topLevelCommentId: item.topLevelCommentId, reason: verdict.reason });
    }
  }

  eligible.sort((left, right) => Date.parse(left.publishedAt) - Date.parse(right.publishedAt));

  return {
    targets: eligible,
    deferredCount: 0,
    skipped,
  };
}
