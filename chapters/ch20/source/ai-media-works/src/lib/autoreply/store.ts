/**
 * The server-only storage contract for chapter 20.
 *
 * WHAT IS STORED, and nothing else:
 *   - the comment's YouTube id (top_level_comment_id) and the video id
 *   - a status from a closed set, and a short reason label from a closed set
 *   - the created reply's YouTube id, when there is one
 *   - timestamps, and the Asia/Seoul day the daily limit was counted against
 *   - the opaque commentThreads.list page cursor a run stopped at
 *   - one operational record per run: ids, an outcome label, and counts
 *
 * WHAT IS NEVER STORED: the comment's text, the commenter's name or channel,
 * the reply text this app generated, or any part of a Gemini prompt or
 * response. Those exist in memory for the length of one request and in the
 * local preview only. src/lib/autoreply/no-comment-text-stored.test.ts checks
 * the contract types and the migration for that, and the 30-day retention cap
 * in ch20_purge_expired bounds even the ids and statuses.
 *
 * The interface is a port on purpose: the Supabase adapter and an in-memory
 * fake both implement it, so every safety and concurrency rule below can be
 * tested without a database.
 */

export const SEND_STATUSES = [
  /** A slot is reserved and a send is in flight or was interrupted. */
  "CLAIMED",
  /** YouTube confirmed the reply, and reply_comment_id holds its id. */
  "SENT",
  /** The send may or may not have landed. No refund. Automation is stopped. */
  "RESULT_UNKNOWN",
  /**
   * A RESULT_UNKNOWN send was later checked against every page of the parent
   * comment's replies and no reply of ours was found. Still never re-sent
   * automatically — a person decides.
   */
  "UNCONFIRMED_NO_REPLY",
  /** YouTube refused before creating anything, so the slot was refunded. */
  "FAILED",
] as const;
export type SendStatus = (typeof SEND_STATUSES)[number];

/** A send row whose outcome is not settled yet, so it needs reconciling. */
export const PENDING_SEND_STATUSES: readonly SendStatus[] = ["CLAIMED", "RESULT_UNKNOWN"];

export const STOP_REASONS = [
  /** A person turned the schedule off. Manual approved sends still work. */
  "manual",
  /**
   * A send's result could not be observed. EVERY send halts until a person
   * acknowledges it — this is the fail-stop, not a retry.
   */
  "result_unknown",
] as const;
export type StopReason = (typeof STOP_REASONS)[number];

/** Who asked for a send: the timer, or a person who approved one reply. */
export const RUN_TRIGGERS = ["scheduled", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export interface AutoReplySettings {
  /**
   * The SCHEDULED automation switch. False by default, false after stop, and
   * false after a halt. A manually approved single send does not need it —
   * that gate is the prepared target plus the absence of a halt.
   */
  enabled: boolean;
  /** The approved channel; re-verified against channels.list on every run. */
  channelId: string | null;
  /** The one approved video; re-verified against videos.list on every run. */
  videoId: string | null;
  /**
   * The baseline instant: only comments published strictly after it count.
   * Decided ONCE, when this channel+video pair was first prepared, and
   * preserved through stop, resume, and redeploy. Preparing the same video
   * again does not move it, so "resume" never silently skips the comments
   * that arrived while the schedule was off.
   */
  activatedAt: string | null;
  stoppedAt: string | null;
  stopReason: StopReason | null;
  /**
   * The commentThreads.list page token the last run stopped at, so the next
   * run continues past the newest 20 instead of re-reading them. null means
   * "start again from the newest page".
   */
  cursorPageToken: string | null;
  cursorUpdatedAt: string | null;
}

export interface SendRecord {
  topLevelCommentId: string;
  videoId: string;
  status: SendStatus;
  reason: string | null;
  replyCommentId: string | null;
  sendDay: string;
  claimedAt: string;
  resolvedAt: string | null;
  lockExpiresAt: string;
}

/**
 * One operational record per run. Deliberately made of labels and counts: it
 * answers "did the timer reach the server, and what did the server do" without
 * keeping anything a viewer wrote.
 */
export interface RunRecord {
  runId: string;
  trigger: RunTrigger;
  /** When the server began the run — proof the HTTP request arrived. */
  startedAt: string;
  /** Null while the run is still going, or if the process died mid-run. */
  completedAt: string | null;
  outcome: string | null;
  consideredCount: number;
  deferredCount: number;
  /** Comments this run left for a person rather than answering. */
  humanReviewCount: number;
  /** Comments whose review failed (a Gemini call did not come back). */
  failureCount: number;
  sentCount: number;
  /** The scheduled switch as it stood when the run finished. */
  automationEnabled: boolean;
  /** True when a later run still has pages left to read on this video. */
  cursorHasMore: boolean;
}

/**
 * The result of trying to reserve the right to reply to one comment.
 *
 * The outcomes are decided atomically so two runs racing on the same comment
 * cannot both send. Per-day counters are retained as historical statistics.
 */
export type ClaimOutcome =
  | { kind: "claimed"; sendDay: string; reservedCount: number }
  /** This comment already has a row. Idempotency: never a second send. */
  | { kind: "already_recorded"; status: SendStatus };

export const SEND_GATE_REFUSALS = [
  /** No channel/video/baseline is stored, so there is nothing to send for. */
  "not_prepared",
  /** A scheduled run asked, but the schedule is off. */
  "automation_off",
  /** A previous send's result was never observed. Nothing may be sent. */
  "halted",
  /** Another send holds the single global send lease right now. */
  "send_in_progress",
] as const;
export type SendGateRefusal = (typeof SEND_GATE_REFUSALS)[number];

/**
 * The answer to "may I call comments.insert, right now?".
 *
 * Granted means the state was re-read under a row lock AND the one global send
 * lease was taken in the same statement. That combination is what stops the
 * race the fail-stop would otherwise lose: if one run halts on an unobserved
 * result, no other run can be between its own check and its own insert,
 * because it could not have taken the lease.
 */
export type SendGate =
  | { kind: "granted"; settings: AutoReplySettings }
  | { kind: "refused"; reason: SendGateRefusal };

export interface DayCounts {
  /** Slots taken today, including in-flight and unresolved ones. */
  reservedCount: number;
  /** Rows confirmed SENT today. */
  sentCount: number;
}

export interface AutoReplyStore {
  readSettings(): Promise<AutoReplySettings>;

  /**
   * Records the approved channel and video and, the FIRST time this pair is
   * prepared, the baseline instant. Preparing the same pair again keeps the
   * original baseline and the current page cursor. It does not turn the
   * schedule on, does not clear a halt, and never sends anything.
   */
  prepareTarget(input: {
    channelId: string;
    videoId: string;
    activatedAt: string;
  }): Promise<AutoReplySettings>;

  /**
   * Turns the SCHEDULE on for the already-prepared target and clears a stop.
   * Refuses (by leaving enabled false) when nothing is prepared. The baseline
   * instant is not touched, so resuming does not move the floor.
   */
  enableSchedule(input: { at: string; videoId: string; activatedAt: string }): Promise<AutoReplySettings>;

  stop(input: { stoppedAt: string; reason: StopReason }): Promise<AutoReplySettings>;

  /** Remembers where the comment walk stopped, or clears it with null. */
  saveCursor(input: { pageToken: string | null; at: string }): Promise<void>;

  /**
   * Re-reads the state under a row lock and takes the single global send
   * lease, in one statement. Must be called immediately before claimSend, and
   * released with endSend once the send is settled.
   */
  beginSend(input: {
    holder: string;
    requireEnabled: boolean;
    now: string;
    leaseExpiresAt: string;
  }): Promise<SendGate>;

  /** Releases the send lease, but only if this holder still owns it. */
  endSend(input: { holder: string }): Promise<void>;

  /**
   * Atomically: refuse if this comment already has a row, refuse if today's
   * comment already has a record, otherwise insert the row and
   * increment the counter. One round trip, one transaction — a read followed
   * by a separate write would let two concurrent runs both pass the check.
   */
  claimSend(input: {
    topLevelCommentId: string;
    videoId: string;
    sendDay: string;
    claimedAt: string;
    lockExpiresAt: string;
    reason: string;
  }): Promise<ClaimOutcome>;

  /** Confirms a claimed (or later-reconciled) row as SENT. Quota unchanged. */
  finalizeSent(input: {
    topLevelCommentId: string;
    replyCommentId: string;
    resolvedAt: string;
  }): Promise<void>;

  /**
   * Refunds the reserved slot. Callable ONLY when YouTube refused before
   * creating anything, so the reply provably does not exist.
   */
  releaseSend(input: {
    topLevelCommentId: string;
    reason: string;
    resolvedAt: string;
  }): Promise<void>;

  /**
   * Marks the send RESULT_UNKNOWN and stops automation in the SAME
   * transaction, with no refund. Two separate calls would leave automation
   * running if the process died between them; this must not be splittable.
   */
  haltOnResultUnknown(input: {
    topLevelCommentId: string;
    reason: string;
    resolvedAt: string;
  }): Promise<AutoReplySettings>;

  /** Records that a full reply-page walk found no reply of ours. No refund. */
  markUnconfirmedNoReply(input: {
    topLevelCommentId: string;
    resolvedAt: string;
  }): Promise<void>;

  /** Rows in CLAIMED or RESULT_UNKNOWN, oldest first. */
  listPendingSends(): Promise<SendRecord[]>;

  /**
   * The statuses already on record for these comment ids. Used both to skip
   * Gemini work on comments that were already handled and to de-duplicate an
   * overlapping re-read after a page cursor was lost — the claim is still the
   * guarantee, this only avoids wasted calls and repeated work.
   */
  findRecordedStatuses(topLevelCommentIds: readonly string[]): Promise<Map<string, SendStatus>>;

  countDay(sendDay: string): Promise<DayCounts>;

  listRecentSends(limit: number): Promise<SendRecord[]>;
  /** Filter before limiting so rejected attempts cannot hide recent sends. */
  listRecentConfirmedSends(since: string): Promise<SendRecord[]>;

  /** Opens a run record. Written before any work, so arrival is observable. */
  beginRun(input: { runId: string; trigger: RunTrigger; startedAt: string }): Promise<void>;

  /** Closes the run record with its outcome and counts. */
  finishRun(input: {
    runId: string;
    completedAt: string;
    outcome: string;
    consideredCount: number;
    deferredCount: number;
    humanReviewCount: number;
    failureCount: number;
    sentCount: number;
    automationEnabled: boolean;
    cursorHasMore: boolean;
  }): Promise<void>;

  /** The most recently started run, or null when none is on record. */
  readLastRun(): Promise<RunRecord | null>;

  /** Recent operational records, including incomplete runs. */
  listRecentRuns(limit: number): Promise<RunRecord[]>;

  /** Deletes every send row, quota row, and run record older than `before`. */
  purgeExpired(input: { before: string }): Promise<{ purgedCount: number }>;
}
