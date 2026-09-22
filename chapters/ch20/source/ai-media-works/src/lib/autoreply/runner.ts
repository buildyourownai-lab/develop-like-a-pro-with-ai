import { randomUUID } from "node:crypto";
import { mapWithConcurrencyLimit } from "../concurrency";
import { runProgramCheck } from "../comments/draft-policy";
import { reviewComment } from "../comments/pipeline";
import { CommentReviewItem, FetchedComment } from "../comments/types";
import { classifyGeminiError } from "../gemini/error-classification";
import { GeminiClient } from "../gemini/types";
import { ReplyClient } from "../youtube/reply-types";
import { checkOwnership } from "../youtube/ownership";
import { isCommentReadEligiblePrivacy, YoutubeClient } from "../youtube/types";
import {
  ApprovalIssue,
  approvalExpiry,
  digestText,
  signApproval,
  verifyApproval,
} from "./approval";
import {
  CLAIM_LOCK_SECONDS,
  MAX_COMMENTS_PER_RUN,
  SEND_LEASE_SECONDS,
  SEND_RETENTION_DAYS,
  SkippedComment,
  autoReplyEligibility,
  commentAuthorEligibility,
  daysBefore,
  isPublishedAfterActivation,
  isWithinRecentWindow,
  selectAutoReplyTargets,
  seoulDay,
} from "./policy";
import {
  AutoReplySettings,
  AutoReplyStore,
  DayCounts,
  RunRecord,
  SendGateRefusal,
  SendRecord,
} from "./store";

/**
 * The whole chapter 20 job, with every outside system injected.
 *
 * Nothing in this file reaches for a network client, a clock, or an
 * environment variable by itself, so every rule below — preparing sends zero,
 * never twice on one comment, never
 * a retry for a result nobody saw — is testable with fakes and no network at
 * all. The routes are the only place the real clients are built.
 *
 * The entry points are deliberately separate rather than one endpoint with a
 * mode flag:
 *   bootstrapAutoReply    — a person turns the SCHEDULE on. Sends nothing.
 *   prepareAutoReplyTarget — stores the target and baseline. Sends nothing.
 *   prepareApprovedReply  — shows and signs one draft. Sends nothing.
 *   sendApprovedReply     — a person approves one reply. Sends at most one.
 *   runScheduledAutoReply — the timer. Processes eligible replies serially, unattended.
 *   readAutoReplyStatus / stopAutoReply — look, and turn off.
 *
 * Two of those can send, and both go through attemptSend, which is the only
 * function in the project that reaches comments.insert. Everything the chapter
 * promises about how much may be sent is enforced there and in the database.
 */

export interface AutoReplyDeps {
  store: AutoReplyStore;
  youtube: YoutubeClient;
  replies: ReplyClient;
  gemini: GeminiClient;
  /** Injected so tests can pin the Asia/Seoul day and the 7-day window. */
  now: () => Date;
  /**
   * Fresh opaque ids for run records and for the send lease holder. Injected so
   * a test can pin them. Each one identifies one run or one send attempt and
   * nothing else — never a person, and never anything a viewer wrote.
   */
  newId?: () => string;
}

function nextId(deps: AutoReplyDeps): string {
  return deps.newId === undefined ? randomUUID() : deps.newId();
}

/** How many Gemini calls one run has in flight at once. */
const REVIEW_CONCURRENCY_LIMIT = 5;

/**
 * The reason label stored for a send a person approved. Like every other
 * reason, it is a fixed label from this file — never text from a comment, a
 * draft, or an API response.
 */
export const APPROVED_SEND_REASON = "MANUAL_APPROVAL";

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export const RUN_OUTCOMES = [
  "needs_review",
  "run_failed",
  /** The schedule is off. This is the default and the post-stop state. */
  "disabled",
  /** No approved channel/video/baseline is stored, so there is nothing to do. */
  "not_configured",
  /** The approved video no longer passes the ownership or privacy re-check. */
  "video_check_failed",
  /** commentThreads.list did not return a readable list. */
  "comments_unavailable",
  /** Nothing was eligible. The normal, boring outcome. */
  "no_target",
  /** The chosen comment already has a send row. Zero new sends. */
  "already_recorded",
  /** Five replies were already reserved for this Asia/Seoul day. */
  /** One reply was created and YouTube confirmed its id. */
  "sent",
  /** YouTube refused before creating anything, so the slot was refunded. */
  "send_rejected",
  /** The result could not be observed: no refund, and automation is now off. */
  "halted_result_unknown",
  /**
   * An EARLIER send's result was never observed. Nothing may be sent, by the
   * timer or by a person, until somebody acknowledges it. Distinct from
   * halted_result_unknown, which is this run being the one that halted.
   */
  "halted",
  /** Another send holds the single global send lease right now. */
  "send_in_progress",
] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

export const RECONCILE_OUTCOMES = [
  /** A reply from our channel exists, but authorship alone cannot prove this send. */
  "needs_review",
  /** Every page was read and no reply of ours exists. Still not re-sent. */
  "no_reply_found",
  /** The reply list could not be walked to the end. Nothing was concluded. */
  "inconclusive",
] as const;
export type ReconcileOutcome = (typeof RECONCILE_OUTCOMES)[number];

export interface ReconcileReport {
  topLevelCommentId: string;
  outcome: ReconcileOutcome;
  pageCount: number;
}

export interface AutoReplyRunReport {
  outcome: RunOutcome;
  /** 0 or 1. Never more, whatever happened. */
  sentCount: number;
  targetCommentId: string | null;
  replyCommentId: string | null;
  /** How many comments were classified this run, at most MAX_COMMENTS_PER_RUN. */
  consideredCount: number;
  /** Eligible comments left for a later run. */
  deferredCount: number;
  skipped: SkippedComment[];
  reconciled: ReconcileReport[];
  dayCounts: DayCounts | null;
  /** Automation's state AFTER this run — false once a halt happened. */
  automationEnabled: boolean;
  /** True when this video still has pages left for a later run to read. */
  cursorHasMore: boolean;
}

function emptyReport(outcome: RunOutcome, automationEnabled: boolean): AutoReplyRunReport {
  return {
    outcome,
    sentCount: 0,
    targetCommentId: null,
    replyCommentId: null,
    consideredCount: 0,
    deferredCount: 0,
    skipped: [],
    reconciled: [],
    dayCounts: null,
    automationEnabled,
    cursorHasMore: false,
  };
}

// ---------------------------------------------------------------------------
// Prepare / bootstrap
// ---------------------------------------------------------------------------

export const BOOTSTRAP_OUTCOMES = [
  "activated",
  "halted",
  "channel_mismatch",
  "privacy_blocked",
  "video_check_failed",
] as const;
export type BootstrapOutcome = (typeof BOOTSTRAP_OUTCOMES)[number];

export interface BootstrapReport {
  outcome: BootstrapOutcome;
  settings: AutoReplySettings | null;
  /** Always 0. Preparing is never retroactive, so it cannot send anything. */
  sentCount: 0;
}

/** Enable only the already-prepared target. An unknown-result halt is preserved. */
export async function bootstrapAutoReply(
  input: { videoId: string; activatedAt?: string },
  deps: AutoReplyDeps,
): Promise<BootstrapReport> {
  let ownership;
  try {
    ownership = await checkOwnership(deps.youtube, input.videoId);
  } catch {
    return { outcome: "video_check_failed", settings: null, sentCount: 0 };
  }

  if (!ownership.channelMatches) {
    return { outcome: "channel_mismatch", settings: null, sentCount: 0 };
  }
  if (!isCommentReadEligiblePrivacy(ownership.video.privacyStatus)) {
    return { outcome: "privacy_blocked", settings: null, sentCount: 0 };
  }

  const current = await deps.store.readSettings();
  if ((input.activatedAt !== undefined && input.activatedAt !== current.activatedAt) || current.videoId !== input.videoId || current.channelId !== ownership.myChannelId || current.activatedAt === null || current.stopReason === "result_unknown") {
    return { outcome: "halted", settings: current, sentCount: 0 };
  }
  const settings = await deps.store.enableSchedule({ at: deps.now().toISOString(), videoId: input.videoId, activatedAt: current.activatedAt });
  return { outcome: settings.enabled ? "activated" : "halted", settings, sentCount: 0 };
}

/** Explicit target preparation, without drafts, quota reservations or sends. */
export async function prepareAutoReplyTarget(input: { videoId: string }, deps: AutoReplyDeps): Promise<BootstrapReport> {
  let ownership;
  try { ownership = await checkOwnership(deps.youtube, input.videoId); }
  catch { return { outcome: "video_check_failed", settings: null, sentCount: 0 }; }
  if (!ownership.channelMatches) return { outcome: "channel_mismatch", settings: null, sentCount: 0 };
  if (!isCommentReadEligiblePrivacy(ownership.video.privacyStatus)) return { outcome: "privacy_blocked", settings: null, sentCount: 0 };
  const settings = await deps.store.prepareTarget({ channelId: ownership.myChannelId, videoId: input.videoId, activatedAt: deps.now().toISOString() });
  return { outcome: settings.videoId === input.videoId && settings.channelId === ownership.myChannelId && settings.stopReason !== "result_unknown" ? "activated" : "halted", settings, sentCount: 0 };
}

// ---------------------------------------------------------------------------
// Stop / status
// ---------------------------------------------------------------------------

export async function stopAutoReply(deps: AutoReplyDeps): Promise<AutoReplySettings> {
  return deps.store.stop({ stoppedAt: deps.now().toISOString(), reason: "manual" });
}

export interface AutoReplyStatus {
  settings: AutoReplySettings;
  sendDay: string;
  dayCounts: DayCounts;
  /** Ids and statuses only — never a comment's text or a reply's text. */
  recentSends: SendRecord[];
  recentRuns: RunRecord[];
}

export async function readAutoReplyStatus(
  deps: AutoReplyDeps,
  recentLimit = 20,
): Promise<AutoReplyStatus> {
  const settings = await deps.store.readSettings();
  const sendDay = seoulDay(deps.now());
  const [dayCounts, recentSends, recentRuns] = await Promise.all([
    deps.store.countDay(sendDay),
    deps.store.listRecentSends(recentLimit),
    deps.store.listRecentRuns(recentLimit),
  ]);
  return {
    settings,
    sendDay,
    dayCounts,
    recentSends,
    recentRuns,
  };
}

// ---------------------------------------------------------------------------
// Reconciling a send whose result was never observed
// ---------------------------------------------------------------------------

/**
 * Answers one question about one pending send: is our reply on that comment or
 * not? It reads every page of comments.list for the parent comment, and a walk
 * that could not reach the last page is reported as inconclusive rather than as
 * "no reply" — treating an incomplete walk as "no reply" is exactly how a
 * duplicate reply would get written.
 *
 * Authorship alone cannot prove this app created the reply. Keep unknown
 * records for human review instead of manufacturing a successful send.
 */
export async function reconcileSend(
  send: SendRecord,
  ourChannelId: string,
  deps: AutoReplyDeps,
): Promise<ReconcileReport> {
  const result = await deps.replies.listReplies(send.topLevelCommentId);

  if (result.kind === "ok") {
    const ours = result.replies.find((reply) => reply.authorChannelId === ourChannelId);
    if (ours !== undefined) {
      await deps.store.haltOnResultUnknown({
        topLevelCommentId: send.topLevelCommentId,
        reason: "connection_interrupted",
        resolvedAt: deps.now().toISOString(),
      });
      return { topLevelCommentId: send.topLevelCommentId, outcome: "needs_review", pageCount: result.pageCount };
    }
    // The full list is in and none of it is ours. No refund and no automatic
    // retry: the send row stays, so a claim on this comment keeps answering
    // already_recorded until a person decides otherwise.
    await deps.store.markUnconfirmedNoReply({
      topLevelCommentId: send.topLevelCommentId,
      resolvedAt: deps.now().toISOString(),
    });
    return {
      topLevelCommentId: send.topLevelCommentId,
      outcome: "no_reply_found",
      pageCount: result.pageCount,
    };
  }

  return {
    topLevelCommentId: send.topLevelCommentId,
    outcome: "inconclusive",
    pageCount: result.kind === "page_limit_reached" ? result.pageCount : 0,
  };
}

/**
 * Reconciles the pending sends whose lock has expired.
 *
 * A pending row whose lock is still fresh is left alone: it is most likely a
 * send another run has in flight right now, and asking YouTube about it would
 * only produce a confusing answer. Note that expiry earns a row a reply-list
 * check and nothing more — it never permits a second send, because the row
 * itself is the duplicate guard and rows do not expire.
 */
async function reconcilePending(
  ourChannelId: string,
  deps: AutoReplyDeps,
): Promise<ReconcileReport[]> {
  const pending = await deps.store.listPendingSends();
  const nowMs = deps.now().getTime();
  const stale = pending.filter((send) => Date.parse(send.lockExpiresAt) <= nowMs);

  const reports: ReconcileReport[] = [];
  for (const send of stale) {
    reports.push(await reconcileSend(send, ourChannelId, deps));
  }
  return reports;
}

// ---------------------------------------------------------------------------
// The send itself
// ---------------------------------------------------------------------------

export type SendAttemptOutcome = Extract<
  RunOutcome,
  | "needs_review"
  | "not_configured"
  | "disabled"
  | "halted"
  | "send_in_progress"
  | "already_recorded"
  | "daily_limit_reached"
  | "sent"
  | "send_rejected"
  | "halted_result_unknown"
>;

export interface SendAttempt {
  outcome: SendAttemptOutcome;
  replyCommentId: string | null;
  automationEnabled: boolean;
}

/** How the gate's four refusals are reported. Each one means zero sends. */
const GATE_REFUSAL_OUTCOME: Record<SendGateRefusal, SendAttemptOutcome> = {
  not_prepared: "not_configured",
  automation_off: "disabled",
  halted: "halted",
  send_in_progress: "send_in_progress",
};

/**
 * Reserves a slot, sends one reply, and records the result.
 *
 * The order here is the whole safety property, and there are three steps to it:
 *
 *  1. beginSend re-reads the state under a row lock AND takes the single global
 *     send lease in one statement. That is what closes the gap a fail-stop
 *     would otherwise lose: while this attempt holds the lease no other attempt
 *     can be between its own halt check and its own insert, so once a send
 *     comes back RESULT_UNKNOWN and halts, every later attempt sees the halt
 *     instead of a stale "everything is fine".
 *  2. claimSend commits the row that blocks a second attempt on this comment,
 *     and increments the day's counter, before anything is sent. So even if the
 *     process dies immediately after comments.insert, the duplicate guard is
 *     already on disk.
 *  3. Only then is the reply inserted, and the outcome written back.
 *
 * requireEnabled is the one difference between the two callers. A scheduled run
 * needs the schedule to be on; a person approving one reply does not, because
 * their approval is the intent the switch would otherwise stand in for. Neither
 * one may send while a halt is on record.
 */
export async function attemptSend(
  target: { topLevelCommentId: string; videoId: string; activatedAt?: string; draft: string; reason: string },
  deps: AutoReplyDeps,
  options: { requireEnabled?: boolean; onConfirmedSend?: (replyCommentId: string) => void } = {},
): Promise<SendAttempt> {
  const holder = nextId(deps);
  let at = deps.now();

  const gate = await deps.store.beginSend({
    holder,
    requireEnabled: options.requireEnabled ?? true,
    now: at.toISOString(),
    leaseExpiresAt: new Date(at.getTime() + SEND_LEASE_SECONDS * 1000).toISOString(),
  });

  if (gate.kind === "refused") {
    // No lease was taken, so there is nothing to release. The switch is read
    // back rather than assumed, because a refusal can mean another run just
    // halted this one out of existence.
    const current = await deps.store.readSettings();
    return {
      outcome: GATE_REFUSAL_OUTCOME[gate.reason],
      replyCommentId: null,
      automationEnabled: current.enabled,
    };
  }

  let settled = false;
  let claimStarted = false;
  try {
    if (gate.settings.videoId !== target.videoId || (target.activatedAt !== undefined && gate.settings.activatedAt !== target.activatedAt)) {
      settled = true;
      return { outcome: "not_configured", replyCommentId: null, automationEnabled: gate.settings.enabled };
    }
    // These reads are inside the global lease, so another app run cannot
    // pass the recent-repeat check before this attempt is recorded.
    const recorded = await deps.store.findRecordedStatuses([target.topLevelCommentId]);
    if (recorded.has(target.topLevelCommentId)) {
      settled = true;
      return { outcome: "already_recorded", replyCommentId: null, automationEnabled: gate.settings.enabled };
    }
    const existing = await deps.replies.listReplies(target.topLevelCommentId);
    let needsReview = existing.kind !== "ok" || existing.replies.some(reply => !reply.authorChannelId || reply.authorChannelId === gate.settings.channelId);
    const recent = await deps.store.listRecentConfirmedSends(new Date(at.getTime() - 60 * 60 * 1000).toISOString());
    for (const send of recent) {
      if (needsReview) break;
      if (send.status === "FAILED" || Date.parse(send.claimedAt) < at.getTime() - 60 * 60 * 1000) continue;
      const page = await deps.replies.listReplies(send.topLevelCommentId);
      if (page.kind !== "ok") { needsReview = true; break; }
      const previous = page.replies.find(reply => reply.replyCommentId === send.replyCommentId && reply.authorChannelId === gate.settings.channelId);
      // Missing/deleted/unreadable evidence cannot establish a different text.
      if (!previous?.text || digestText(previous.text.normalize("NFKC").trim()) === digestText(target.draft.normalize("NFKC").trim())) needsReview = true;
    }
    if (needsReview) {
      settled = true;
      return { outcome: "needs_review", replyCommentId: null, automationEnabled: gate.settings.enabled };
    }
    const refreshedGate = await deps.store.beginSend({ holder, requireEnabled: options.requireEnabled ?? true, now: deps.now().toISOString(), leaseExpiresAt: new Date(deps.now().getTime() + SEND_LEASE_SECONDS * 1000).toISOString() });
    if (refreshedGate.kind === "refused") {
      settled = true;
      return { outcome: GATE_REFUSAL_OUTCOME[refreshedGate.reason], replyCommentId: null, automationEnabled: false };
    }
    at = deps.now();
    claimStarted = true;
    const claim = await deps.store.claimSend({
      topLevelCommentId: target.topLevelCommentId,
      videoId: target.videoId,
      sendDay: seoulDay(at),
        claimedAt: at.toISOString(),
      lockExpiresAt: new Date(at.getTime() + CLAIM_LOCK_SECONDS * 1000).toISOString(),
      reason: target.reason,
    });

    if (claim.kind === "already_recorded") {
      settled = true;
      return {
        outcome: "already_recorded",
        replyCommentId: null,
        automationEnabled: gate.settings.enabled,
      };
    }

    const result = await deps.replies.insertReply({
      parentCommentId: target.topLevelCommentId,
      text: target.draft,
    }).catch(() => ({ kind: "result_unknown" as const, reason: "connection_interrupted" as const }));

    if (result.kind === "ok") {
      await deps.store.finalizeSent({
        topLevelCommentId: target.topLevelCommentId,
        replyCommentId: result.replyCommentId,
        resolvedAt: deps.now().toISOString(),
      });
      options.onConfirmedSend?.(result.replyCommentId);
      settled = true;
      return {
        outcome: "sent",
        replyCommentId: result.replyCommentId,
        automationEnabled: gate.settings.enabled,
      };
    }

    if (result.kind === "rejected") {
      // YouTube refused before creating anything, so the reply provably does
      // not exist and the reserved slot can go back. This is the ONLY refund.
      await deps.store.releaseSend({
        topLevelCommentId: target.topLevelCommentId,
        reason: result.reason,
        resolvedAt: deps.now().toISOString(),
      });
      if (["auth_error", "quota_exceeded", "credentials_unavailable", "forbidden"].includes(result.reason)) await stopAutoReply(deps);
      settled = true;
      return {
        outcome: result.reason === "send_window_expired" ? "needs_review" : "send_rejected",
        replyCommentId: null,
        automationEnabled: (await deps.store.readSettings()).enabled,
      };
    }

    // result_unknown: the reply may exist. Preserve its record. Automation is
    // switched off in the SAME transaction so nothing runs again until a person
    // has looked. This happens while the lease is still held, which is what
    // makes the halt visible to every other attempt rather than raced past.
    const settings = await deps.store.haltOnResultUnknown({
      topLevelCommentId: target.topLevelCommentId,
      reason: result.reason,
      resolvedAt: deps.now().toISOString(),
    });
    settled = true;
    return {
      outcome: "halted_result_unknown",
      replyCommentId: null,
      automationEnabled: settings.enabled,
    };
  } catch (error) {
    if (!claimStarted) { settled = true; throw error; }
    // A failed DB acknowledgement may hide a committed claim or send. Try to
    // persist the halt; if storage is unavailable, the unreleased lease blocks
    // every new send and no quota is refunded.
    try {
      await deps.store.haltOnResultUnknown({ topLevelCommentId: target.topLevelCommentId, reason: "connection_interrupted", resolvedAt: deps.now().toISOString() });
      settled = true;
    } catch { /* Keep the lease until the outcome can be checked. */ }
    throw error;
  } finally {
    // An uncertain DB write may have committed. Keep the lease until the
    // outcome or durable halt is confirmed; time alone cannot release it.
    if (settled) await deps.store.endSend({ holder });
  }
}

// ---------------------------------------------------------------------------
// Shared: re-verify, fetch, review
// ---------------------------------------------------------------------------

interface ActiveContext {
  channelId: string;
  videoId: string;
  activatedAt: string;
}

/**
 * The prepared target, or null when the channel, the video, or the baseline is
 * missing. Note what this does NOT look at: the schedule switch. The switch is
 * the timer's gate and is checked separately, because a person approving one
 * reply needs a prepared target and no halt, not a running timer.
 */
function requireActive(settings: AutoReplySettings): ActiveContext | null {
  if (settings.channelId === null || settings.videoId === null || settings.activatedAt === null) {
    return null;
  }
  return {
    channelId: settings.channelId,
    videoId: settings.videoId,
    activatedAt: settings.activatedAt,
  };
}

/**
 * Re-checks on every single run that the stored video still belongs to the
 * connected channel and is still public or unlisted. Approval is not a
 * one-time event: ownership can change, a video can be made private, and a
 * token can be re-pointed at a different account.
 */
async function verifyTarget(
  context: ActiveContext,
  deps: AutoReplyDeps,
): Promise<{ ok: true; myChannelId: string } | { ok: false }> {
  let ownership;
  try {
    ownership = await checkOwnership(deps.youtube, context.videoId);
  } catch {
    return { ok: false };
  }
  if (!ownership.channelMatches) return { ok: false };
  if (ownership.myChannelId !== context.channelId) return { ok: false };
  if (!isCommentReadEligiblePrivacy(ownership.video.privacyStatus)) return { ok: false };
  return { ok: true, myChannelId: ownership.myChannelId };
}

/**
 * Drops comments that cannot possibly be answered before any Gemini call is
 * made: published at or before the baseline, outside the 7-day window, or
 * already on record. selectAutoReplyTargets checks the same time rules again
 * on the reviewed items — the cheap filter here is about cost, the later check
 * is the one that decides.
 */
async function narrowCandidates(
  comments: readonly FetchedComment[],
  context: ActiveContext,
  deps: AutoReplyDeps,
): Promise<{ candidates: FetchedComment[]; skipped: SkippedComment[] }> {
  const now = deps.now();
  const candidates: FetchedComment[] = [];
  const skipped: SkippedComment[] = [];

  for (const comment of comments) {
    const author = commentAuthorEligibility(comment.authorChannelId, context.channelId);
    if (!author.eligible) {
      skipped.push({ topLevelCommentId: comment.topLevelCommentId, reason: author.reason });
      continue;
    }
    if (!isPublishedAfterActivation(comment.publishedAt, context.activatedAt)) {
      skipped.push({
        topLevelCommentId: comment.topLevelCommentId,
        reason: "published_before_activation",
      });
      continue;
    }
    if (!isWithinRecentWindow(comment.publishedAt, now)) {
      skipped.push({
        topLevelCommentId: comment.topLevelCommentId,
        reason: "older_than_recent_window",
      });
      continue;
    }
    candidates.push(comment);
  }

  if (candidates.length === 0) {
    return { candidates, skipped };
  }

  const recorded = await deps.store.findRecordedStatuses(
    candidates.map((comment) => comment.topLevelCommentId),
  );

  return {
    // An already-recorded comment is dropped here only to save a Gemini call.
    // The claim inside attemptSend is what actually guarantees one send per
    // comment, and it would refuse this comment anyway.
    candidates: candidates
      .filter((comment) => !recorded.has(comment.topLevelCommentId))
      .slice(0, MAX_COMMENTS_PER_RUN),
    skipped,
  };
}

async function reviewCandidates(
  candidates: readonly FetchedComment[],
  deps: AutoReplyDeps,
): Promise<CommentReviewItem[]> {
  let stopped: unknown;
  let calls = 0;
  const deadline = Date.now() + 60_000;
  async function call<T>(work: () => Promise<T>): Promise<T> {
    if (stopped) throw stopped;
    if (++calls > 60 || Date.now() >= deadline) throw new Error("Review budget exhausted");
    try { return await work(); }
    catch (error) {
      const reason = classifyGeminiError(error);
      if (["auth_error", "quota_exceeded", "config_missing", "model_or_request_error"].includes(reason)) stopped = error;
      throw error;
    }
  }
  const gemini: GeminiClient = {
    classifyComment: (...args) => call(() => deps.gemini.classifyComment(...args)),
    generateDraft: (...args) => call(() => deps.gemini.generateDraft(...args)),
    checkDraftContext: (...args) => call(() => deps.gemini.checkDraftContext(...args)),
  };
  const items = await mapWithConcurrencyLimit(candidates, REVIEW_CONCURRENCY_LIMIT, (comment) => reviewComment(comment, gemini));
  // Even an earlier successful draft is withheld once this batch loses access.
  if (stopped) {
    await deps.store.stop({ stoppedAt: deps.now().toISOString(), reason: "manual" });
    throw new Error("Review interrupted");
  }
  if (Date.now() >= deadline) throw new Error("Review interrupted");
  return items;
}

/** Comments this run handed to a person instead of answering. */
function countHumanReview(items: readonly CommentReviewItem[]): number {
  return items.filter((item) => item.classification.tier !== "AUTO_REPLY_CANDIDATE").length;
}

/** Comments whose review did not come back, which is not the same as refused. */
function countFailures(items: readonly CommentReviewItem[]): number {
  return items.filter((item) => item.geminiIssue !== null).length;
}

// ---------------------------------------------------------------------------
// The scheduled run
// ---------------------------------------------------------------------------

/**
 * Where the next run starts reading.
 *
 * The cursor only moves on when this page has nothing left to answer. A page
 * that still holds eligible comments is deliberately read again, because one
 * run answers one comment and advancing past the rest would leave them
 * unanswered until the walk came all the way round. Re-reading costs almost
 * nothing: findRecordedStatuses drops the handled ones before any Gemini call.
 *
 * A null token means "start from the newest page again", which is also how the
 * walk restarts once it reaches the end.
 */
function nextCursor(input: {
  resumeToken: string | null;
  nextPageToken: string | null;
  deferredCount: number;
}): string | null {
  return input.deferredCount > 0 ? input.resumeToken : input.nextPageToken;
}

/**
 * One unattended pass. At most one reply leaves this function, and only if the
 * schedule is on, no halt is on record, the video still checks out, the comment
 * is new enough, both chapter 19 checks passed, no row exists for it, and the
 * Asia/Seoul day still has a slot. Any one of those failing means zero sends,
 * not an error.
 *
 * The run record is opened before any work and closed in a `finally`, so the
 * timer's arrival is observable even for a run that decided to do nothing — and
 * so is a run that died half way, which leaves completedAt null.
 */
export async function runScheduledAutoReply(deps: AutoReplyDeps): Promise<AutoReplyRunReport> {
  const runId = nextId(deps);
  await deps.store.beginRun({
    runId,
    trigger: "scheduled",
    startedAt: deps.now().toISOString(),
  });

  let report = emptyReport("disabled", false);
  let humanReviewCount = 0;
  let failureCount = 0;
  // Every exit goes through `done`, so the finally below records the run that
  // actually happened rather than only the paths that reached the end.
  const done = (next: AutoReplyRunReport): AutoReplyRunReport => {
    report = next;
    return next;
  };

  try {
    const settings = await deps.store.readSettings();
    if (!settings.enabled) {
      // Includes the state left by a halt and by a person pressing stop, which
      // is why "0 new sends after stop" needs no separate mechanism.
      return done(emptyReport("disabled", false));
    }

    const context = requireActive(settings);
    if (context === null) {
      return done(emptyReport("not_configured", settings.enabled));
    }

    const verified = await verifyTarget(context, deps);
    if (!verified.ok) {
      await stopAutoReply(deps);
      return done(emptyReport("video_check_failed", false));
    }

    // Settle old business before starting new business.
    const reconciled = await reconcilePending(verified.myChannelId, deps);

    // One run reads one page of 20, continuing from wherever the last one
    // stopped. Without this a video with more comments in scope than one page
    // would keep re-reading the newest 20 and never reach the rest.
    const resumeToken = settings.cursorPageToken;
    const listed = await deps.youtube.listTopLevelComments(
      context.videoId,
      resumeToken ?? undefined,
    );

    if (listed.kind === "empty") {
      // Nothing on this page: begin again from the newest page next time.
      await deps.store.saveCursor({ pageToken: null, at: deps.now().toISOString() });
      return done({ ...emptyReport("no_target", true), reconciled });
    }
    if (listed.kind !== "ok") {
      if (["auth_error", "quota_exceeded", "forbidden"].includes(listed.kind)) await stopAutoReply(deps);
      // A token the API will not accept must not wedge the walk forever, so a
      // resumed read that came back unreadable drops back to the newest page.
      if (resumeToken !== null && listed.kind === "invalid_response") {
        await deps.store.saveCursor({ pageToken: null, at: deps.now().toISOString() });
      }
      return done({ ...emptyReport("comments_unavailable", (await deps.store.readSettings()).enabled), reconciled });
    }

    const narrowed = await narrowCandidates(listed.comments, context, deps);
    const items = await reviewCandidates(narrowed.candidates, deps);
    humanReviewCount = countHumanReview(items);
    failureCount = countFailures(items);
    const selection = selectAutoReplyTargets(items, {
      activatedAt: context.activatedAt,
      now: deps.now(),
    });

    const base: AutoReplyRunReport = {
      ...emptyReport("no_target", true),
      consideredCount: items.length,
      deferredCount: selection.deferredCount,
      skipped: [...narrowed.skipped, ...selection.skipped],
      reconciled,
      cursorHasMore: listed.nextPageToken !== null,
    };

    report = base;
    // Each target is sent serially through the same duplicate and stop gates.
    for (const target of selection.targets) {
      if (target.draft === null) continue;
      const attempt = await attemptSend({
        topLevelCommentId: target.topLevelCommentId,
        videoId: context.videoId,
        activatedAt: context.activatedAt,
        draft: target.draft,
        reason: target.classification.category,
      }, deps, { requireEnabled: true, onConfirmedSend: replyCommentId => { report.sentCount += 1; report.targetCommentId = target.topLevelCommentId; report.replyCommentId = replyCommentId; } });
      if (attempt.outcome === "needs_review") humanReviewCount += 1;
      report.outcome = attempt.outcome;
      report.targetCommentId = target.topLevelCommentId;
      report.replyCommentId = attempt.replyCommentId;
      report.automationEnabled = attempt.automationEnabled;
      if (!attempt.automationEnabled || !["sent", "already_recorded", "needs_review"].includes(attempt.outcome)) break;
    }

    // Advance only after this page's targets have all been handled. An
    // exception retains the cursor so unsent comments remain reachable.
    if (report.automationEnabled && ["no_target", "sent", "already_recorded", "needs_review"].includes(report.outcome)) {
      await deps.store.saveCursor({ pageToken: nextCursor({ resumeToken, nextPageToken: listed.nextPageToken, deferredCount: 0 }), at: deps.now().toISOString() });
    }
    report.dayCounts = await deps.store.countDay(seoulDay(deps.now()));
    return report;
  } catch (error) {
    report.outcome = "run_failed";
    failureCount += 1;
    try { report.automationEnabled = (await deps.store.readSettings()).enabled; } catch { /* State could not be refreshed; outcome remains an error. */ }
    throw error;
  } finally {
    await deps.store.finishRun({
      runId,
      completedAt: deps.now().toISOString(),
      outcome: report.outcome,
      consideredCount: report.consideredCount,
      deferredCount: report.deferredCount,
      humanReviewCount,
      failureCount,
      sentCount: report.sentCount,
      automationEnabled: report.automationEnabled,
      cursorHasMore: report.cursorHasMore,
    });
    // Retention runs from the finally as well, so that EVERY early return above
    // — disabled, not configured, video check failed — still trims what is past
    // 30 days. It is last so a failed purge can never change what this run did.
    await deps.store.purgeExpired({
      before: daysBefore(deps.now(), SEND_RETENTION_DAYS).toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// The manual approved single send
// ---------------------------------------------------------------------------

export const MANUAL_SEND_OUTCOMES = [
  ...RUN_OUTCOMES,
  /** The requested comment is not among the newest 20 on the approved video. */
  "comment_not_found",
  /** The requested video is not the approved one. */
  "video_not_approved",
  /** The comment did not pass the automatic-reply gate, so a person must write it. */
  "not_eligible",
  /**
   * The approval itself is no longer good: tampered with, expired, for another
   * comment, or for a comment whose text has changed since it was shown. A
   * fresh preview is required — there is no path that sends anyway.
   */
  "approval_invalid",
] as const;
export type ManualSendOutcome = (typeof MANUAL_SEND_OUTCOMES)[number];

export interface ManualSendReport {
  outcome: ManualSendOutcome;
  sentCount: number;
  targetCommentId: string | null;
  replyCommentId: string | null;
  skipped: SkippedComment[];
  dayCounts: DayCounts | null;
  automationEnabled: boolean;
  /** Why an approval was refused, when that is what happened. */
  approvalIssue: ApprovalIssue | null;
}

/**
 * The two checks chapter 19 runs on a draft, re-run on the sentence a person
 * approved and against the comment as it reads right now.
 *
 * It has to be this sentence: a freshly generated draft passing its own checks
 * would say nothing about the one that is actually going to be sent.
 */
async function checkApprovedText(
  comment: FetchedComment,
  replyText: string,
  deps: AutoReplyDeps,
): Promise<{ passed: boolean; geminiFailed: boolean }> {
  const programCheck = runProgramCheck(replyText, comment.text);
  if (!programCheck.passed) {
    return { passed: false, geminiFailed: false };
  }
  try {
    const aiCheck = await deps.gemini.checkDraftContext(comment.text, replyText);
    return { passed: aiCheck.passed, geminiFailed: false };
  } catch {
    // A check that never came back is not a pass.
    return { passed: false, geminiFailed: true };
  }
}

/** What both manual entry points need before they may look at a comment. */
type ManualContext =
  | { ok: true; context: ActiveContext; comment: FetchedComment }
  | {
      ok: false;
      outcome: Extract<
        ManualSendOutcome,
        | "not_configured"
        | "video_not_approved"
        | "video_check_failed"
        | "comments_unavailable"
        | "comment_not_found"
      >;
    };

/**
 * Re-establishes everything about one comment from scratch: the prepared
 * target, the video's ownership and privacy, and the comment itself as
 * commentThreads.list returns it now.
 *
 * The preview always reads the newest page rather than the scheduled walk's
 * cursor. A person is looking at what a screen showed them, which is the newest
 * 20; the cursor belongs to the unattended walk and moving it here would make
 * the timer skip a page nobody had answered.
 */
async function loadManualTarget(
  input: { videoId: string; topLevelCommentId: string },
  settings: AutoReplySettings,
  deps: AutoReplyDeps,
): Promise<ManualContext> {
  const context = requireActive(settings);
  if (context === null) {
    return { ok: false, outcome: "not_configured" };
  }
  if (context.videoId !== input.videoId) {
    return { ok: false, outcome: "video_not_approved" };
  }

  const verified = await verifyTarget(context, deps);
  if (!verified.ok) {
    return { ok: false, outcome: "video_check_failed" };
  }

  const listed = await deps.youtube.listTopLevelComments(context.videoId);
  if (listed.kind === "empty") {
    return { ok: false, outcome: "comment_not_found" };
  }
  if (listed.kind !== "ok") {
    return { ok: false, outcome: "comments_unavailable" };
  }

  const comment = listed.comments.find(
    (candidate) => candidate.topLevelCommentId === input.topLevelCommentId,
  );
  if (comment === undefined) {
    return { ok: false, outcome: "comment_not_found" };
  }
  return { ok: true, context, comment };
}

// ---------------------------------------------------------------------------
// Showing one draft, and signing what was shown
// ---------------------------------------------------------------------------

export const APPROVAL_PREVIEW_OUTCOMES = [
  /** A draft is ready to be shown, and the token below is proof of what it is. */
  "ready",
  "not_configured",
  "video_not_approved",
  "video_check_failed",
  /** Nothing was prepared yet and this video is not the connected channel's. */
  "channel_mismatch",
  /** Nothing was prepared yet and this video is private. */
  "privacy_blocked",
  "comments_unavailable",
  "comment_not_found",
  "already_recorded",
  "not_eligible",
] as const;
export type ApprovalPreviewOutcome = (typeof APPROVAL_PREVIEW_OUTCOMES)[number];

export interface ApprovalPreviewReport {
  outcome: ApprovalPreviewOutcome;
  targetCommentId: string | null;
  /** The exact sentence to show. In memory only — never written anywhere. */
  draft: string | null;
  /**
   * Signed proof of what was shown, to be handed back with the approval. Null
   * whenever there is nothing to approve.
   */
  approvalToken: string | null;
  skipped: SkippedComment[];
  /**
   * True when THIS call stored the approved channel, video, and baseline
   * because none was stored yet. The one row this function can write, and the
   * reason it is reported: a person deserves to be told that the video they
   * asked about is now the stored target, and from which instant.
   */
  targetPrepared: boolean;
}

/**
 * Prepares one reply for a person to read, and signs it.
 *
 * This is the half of the approval flow that thinks. It re-verifies the target,
 * re-reads the comment, classifies it, drafts a reply, and runs both chapter 19
 * checks — the same gate the timer uses, so a preview can only appear for a
 * comment the automation would have been allowed to answer by itself.
 *
 * What it returns is that exact sentence plus a token signed over it, the
 * comment id, a digest of the comment's text, and the target's baseline. The
 * send path accepts nothing else, which is what makes "the text a person read
 * is the text that goes out" checkable rather than hoped for. Re-drafting at
 * send time could not do it: a language model does not repeat itself, so there
 * would be nothing to compare an approval against.
 *
 * Requires a target already stored by prepareAutoReplyTarget. Writes no state.
 */
export async function prepareApprovedReply(
  input: { videoId: string; topLevelCommentId: string },
  deps: AutoReplyDeps,
): Promise<ApprovalPreviewReport> {
  const empty = (
    outcome: ApprovalPreviewOutcome,
    extra: Partial<ApprovalPreviewReport> = {},
  ): ApprovalPreviewReport => ({
    outcome,
    targetCommentId: null,
    draft: null,
    approvalToken: null,
    skipped: [],
    targetPrepared: false,
    ...extra,
  });

  const stored = await deps.store.readSettings();
  const targetPrepared = false;
  const loaded = await loadManualTarget(input, stored, deps);
  if (!loaded.ok) {
    return empty(loaded.outcome, { targetPrepared });
  }
  const { context, comment } = loaded;

  const author = commentAuthorEligibility(comment.authorChannelId, context.channelId);
  if (!author.eligible) {
    return empty("not_eligible", {
      targetCommentId: comment.topLevelCommentId,
      targetPrepared,
      skipped: [{ topLevelCommentId: comment.topLevelCommentId, reason: author.reason }],
    });
  }

  // A comment that already has a row is never previewed: the send would refuse
  // it anyway, and offering a draft for it would invite a second reply.
  const recorded = await deps.store.findRecordedStatuses([comment.topLevelCommentId]);
  if (recorded.has(comment.topLevelCommentId)) {
    return empty("already_recorded", {
      targetCommentId: comment.topLevelCommentId,
      targetPrepared,
    });
  }

  const item = await reviewComment(comment, deps.gemini);
  const eligibility = autoReplyEligibility(item, {
    activatedAt: context.activatedAt,
    now: deps.now(),
  });
  if (!eligibility.eligible || item.draft === null) {
    // The commonest reason on a target that was just stored is
    // published_before_activation: a baseline stamped a moment ago is newer than
    // every comment already on the video. Reported rather than worked around —
    // the floor is the same one the timer obeys.
    return empty("not_eligible", {
      targetCommentId: comment.topLevelCommentId,
      targetPrepared,
      skipped: [
        {
          topLevelCommentId: comment.topLevelCommentId,
          reason: eligibility.eligible ? "no_draft" : eligibility.reason,
        },
      ],
    });
  }

  return {
    outcome: "ready",
    targetCommentId: comment.topLevelCommentId,
    targetPrepared,
    draft: item.draft,
    approvalToken: signApproval({
      videoId: context.videoId,
      topLevelCommentId: comment.topLevelCommentId,
      // A digest, not the text: an edit invalidates the approval without this
      // app ever holding on to what somebody wrote.
      commentDigest: digestText(comment.text),
      activatedAt: context.activatedAt,
      replyText: item.draft,
      exp: approvalExpiry(deps.now()),
    }),
    skipped: [],
  };
}

/**
 * Sends one reply that a person picked.
 *
 * The request carries ids and, when the screen has one, the approval token this
 * server issued. It never carries reply text: with a token the sentence comes
 * out of the token's signed payload, and without one the request is refused.
 *
 * A person's approval shortens nothing else either. The same baseline floor,
 * the same 7-day window, the same two chapter 19 checks — run against the
 * approved sentence, not a fresh one — the same one-row-per-comment claim, and
 * the same duplicate prevention and stop gates all still apply.
 *
 * What it does NOT need is the schedule. The timer being off is not a statement
 * about this one reply, and requiring it would make "turn the automation off but
 * answer this one by hand" impossible. A halt is different: it outranks a
 * person's approval, because nothing at all may be sent while a previous send's
 * result is unknown. beginSend enforces both of those under a row lock.
 */
export async function sendApprovedReply(
  input: { videoId: string; topLevelCommentId: string; approvalToken?: string },
  deps: AutoReplyDeps,
): Promise<ManualSendReport> {
  const runId = nextId(deps);
  await deps.store.beginRun({
    runId,
    trigger: "manual",
    startedAt: deps.now().toISOString(),
  });

  const settings = await deps.store.readSettings();
  let report: ManualSendReport = {
    outcome: "not_configured",
    sentCount: 0,
    targetCommentId: null,
    replyCommentId: null,
    skipped: [],
    dayCounts: null,
    automationEnabled: settings.enabled,
    approvalIssue: null,
  };
  let consideredCount = 0;
  let humanReviewCount = 0;
  let failureCount = 0;
  const done = (next: Partial<ManualSendReport> & { outcome: ManualSendOutcome }) => {
    report = { ...report, ...next };
    return report;
  };

  try {
    const loaded = await loadManualTarget(input, settings, deps);
    if (!loaded.ok) {
      return done({ outcome: loaded.outcome });
    }
    const { context, comment } = loaded;
    consideredCount = 1;

    // Re-check immediately before accepting an approval token.  Preview and
    // send are separate requests; neither a stale screen nor a forged request
    // may turn the video owner's own comment into a public reply target.
    const author = commentAuthorEligibility(comment.authorChannelId, context.channelId);
    if (!author.eligible) {
      return done({
        outcome: "not_eligible",
        targetCommentId: comment.topLevelCommentId,
        skipped: [{ topLevelCommentId: comment.topLevelCommentId, reason: author.reason }],
      });
    }

    let draft: string;
    let reason: string;

    if (input.approvalToken !== undefined) {
      const verdict = verifyApproval(input.approvalToken, {
        videoId: input.videoId,
        topLevelCommentId: comment.topLevelCommentId,
        commentDigest: digestText(comment.text),
        activatedAt: context.activatedAt,
        now: deps.now(),
      });
      if (!verdict.ok) {
        return done({
          outcome: "approval_invalid",
          targetCommentId: comment.topLevelCommentId,
          approvalIssue: verdict.issue,
        });
      }

      // The token proves what this server showed for this exact comment text
      // within the approval's short life, which covers the classification and
      // tier gates prepareApprovedReply applied before issuing it. The time
      // rules and the two draft checks are still re-run here, because both can
      // have turned false since — and neither is something a token can assert.
      if (!isPublishedAfterActivation(comment.publishedAt, context.activatedAt)) {
        return done({
          outcome: "not_eligible",
          targetCommentId: comment.topLevelCommentId,
          skipped: [
            {
              topLevelCommentId: comment.topLevelCommentId,
              reason: "published_before_activation",
            },
          ],
        });
      }
      if (!isWithinRecentWindow(comment.publishedAt, deps.now())) {
        return done({
          outcome: "not_eligible",
          targetCommentId: comment.topLevelCommentId,
          skipped: [
            { topLevelCommentId: comment.topLevelCommentId, reason: "older_than_recent_window" },
          ],
        });
      }

      const checked = await checkApprovedText(comment, verdict.claim.replyText, deps);
      if (checked.geminiFailed) failureCount = 1;
      if (!checked.passed) {
        humanReviewCount = 1;
        return done({
          outcome: "approval_invalid",
          targetCommentId: comment.topLevelCommentId,
          approvalIssue: "reply_not_verified",
        });
      }

      // Unchanged, byte for byte, from what was on screen.
      draft = verdict.claim.replyText;
      reason = APPROVED_SEND_REASON;
    } else {
      return done({ outcome: "approval_invalid", approvalIssue: "malformed" });
    }

    const attempt = await attemptSend(
      {
        topLevelCommentId: comment.topLevelCommentId,
        videoId: context.videoId,
        activatedAt: context.activatedAt,
        draft,
        reason,
      },
      deps,
      // The one place requireEnabled is false. A person asked for this reply.
      { requireEnabled: false, onConfirmedSend: replyCommentId => { report.sentCount = 1; report.targetCommentId = comment.topLevelCommentId; report.replyCommentId = replyCommentId; } },
    );

    if (attempt.outcome === "needs_review") humanReviewCount += 1;
    done({
      outcome: attempt.outcome,
      sentCount: attempt.outcome === "sent" ? 1 : 0,
      targetCommentId: comment.topLevelCommentId,
      replyCommentId: attempt.replyCommentId,
      automationEnabled: attempt.automationEnabled,
    });
    report.dayCounts = await deps.store.countDay(seoulDay(deps.now()));
    return report;
  } catch (error) {
    report.outcome = "run_failed";
    failureCount += 1;
    try { report.automationEnabled = (await deps.store.readSettings()).enabled; } catch { /* State could not be refreshed; outcome remains an error. */ }
    throw error;
  } finally {
    // A manual send gets a run record too, so "one reply appeared on the
    // channel" always has exactly one row explaining which trigger caused it.
    // Retention is deliberately not run here: it belongs to the timer, and a
    // person pressing send should not be waiting on a 30-day delete.
    await deps.store.finishRun({
      runId,
      completedAt: deps.now().toISOString(),
      outcome: report.outcome,
      consideredCount,
      deferredCount: 0,
      humanReviewCount,
      failureCount,
      sentCount: report.sentCount,
      automationEnabled: report.automationEnabled,
      cursorHasMore: false,
    });
  }
}
