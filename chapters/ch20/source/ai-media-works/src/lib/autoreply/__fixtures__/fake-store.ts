import {
  AutoReplySettings,
  AutoReplyStore,
  ClaimOutcome,
  DayCounts,
  RunRecord,
  RunTrigger,
  SendGate,
  SendRecord,
  SendStatus,
  StopReason,
} from "../store";

/**
 * An in-memory AutoReplyStore for tests.
 *
 * The point of this fake is not just to avoid a database. It is to model the
 * ONE property the real store gets from SQL: claimSend and beginSend decide and
 * write without ever awaiting in between. Each method body below runs to
 * completion synchronously before the promise resolves, which is JavaScript's
 * version of "one transaction" — so a test can fire several claims concurrently
 * and see the same serialization the `for update` row lock gives in Postgres.
 *
 * If any of these methods were written with an `await` in the middle of a
 * check-then-write, the concurrency tests would pass against the fake and the
 * real code would still be wrong. They are deliberately await-free.
 */
export class FakeAutoReplyStore implements AutoReplyStore {
  private settings: AutoReplySettings = {
    enabled: false,
    channelId: null,
    videoId: null,
    activatedAt: null,
    stoppedAt: null,
    stopReason: null,
    cursorPageToken: null,
    cursorUpdatedAt: null,
  };

  private readonly sends = new Map<string, SendRecord>();
  private readonly reserved = new Map<string, number>();
  private readonly runs: RunRecord[] = [];
  private leaseHolder: string | null = null;
  private leaseExpiresAt: string | null = null;

  /** Every method name in call order, so tests can assert on ordering. */
  readonly calls: string[] = [];

  /** Set to throw from the next store call, to test failure handling. */
  failNextWith: Error | null = null;

  constructor(initial?: Partial<AutoReplySettings>) {
    if (initial !== undefined) {
      this.settings = { ...this.settings, ...initial };
    }
  }

  private record(name: string): void {
    this.calls.push(name);
    const failure = this.failNextWith;
    if (failure !== null) {
      this.failNextWith = null;
      throw failure;
    }
  }

  async readSettings(): Promise<AutoReplySettings> {
    this.record("readSettings");
    return { ...this.settings };
  }

  async prepareTarget(input: {
    channelId: string;
    videoId: string;
    activatedAt: string;
  }): Promise<AutoReplySettings> {
    this.record("prepareTarget");
    if (this.leaseHolder !== null || this.settings.stopReason === "result_unknown") return { ...this.settings };
    const samePair =
      this.settings.channelId === input.channelId && this.settings.videoId === input.videoId;
    const sameVideo = this.settings.videoId === input.videoId;
    this.settings = {
      ...this.settings,
      enabled: samePair ? this.settings.enabled : false,
      channelId: input.channelId,
      videoId: input.videoId,
      // Preserved for a pair that already has a baseline — same rule as the
      // case expression in ch20_prepare_target.
      activatedAt:
        samePair && this.settings.activatedAt !== null
          ? this.settings.activatedAt
          : input.activatedAt,
      cursorPageToken: sameVideo ? this.settings.cursorPageToken : null,
      cursorUpdatedAt: sameVideo ? this.settings.cursorUpdatedAt : null,
    };
    return { ...this.settings };
  }

  async enableSchedule(input: { at: string; videoId: string; activatedAt: string }): Promise<AutoReplySettings> {
    this.record("enableSchedule");
    // The SQL function's where clause refuses an unprepared target by changing
    // nothing, so the caller reads back enabled = false.
    if (
      this.settings.channelId !== null &&
      this.settings.videoId === input.videoId &&
      this.settings.activatedAt === input.activatedAt &&
      this.settings.stopReason !== "result_unknown" && this.leaseHolder === null
    ) {
      this.settings = { ...this.settings, enabled: true, stoppedAt: null, stopReason: null };
    }
    void input.at;
    return { ...this.settings };
  }

  async saveCursor(input: { pageToken: string | null; at: string }): Promise<void> {
    this.record("saveCursor");
    this.settings = {
      ...this.settings,
      cursorPageToken: input.pageToken,
      cursorUpdatedAt: input.at,
    };
  }

  async beginSend(input: {
    holder: string;
    requireEnabled: boolean;
    now: string;
    leaseExpiresAt: string;
  }): Promise<SendGate> {
    this.record("beginSend");

    // --- one critical section, no await inside ---------------------------
    if (this.settings.stopReason === "result_unknown") {
      return { kind: "refused", reason: "halted" };
    }
    if (
      this.settings.channelId === null ||
      this.settings.videoId === null ||
      this.settings.activatedAt === null
    ) {
      return { kind: "refused", reason: "not_prepared" };
    }
    if (input.requireEnabled && !this.settings.enabled) {
      return { kind: "refused", reason: "automation_off" };
    }
    if (
      this.leaseHolder !== null &&
      this.leaseHolder !== input.holder
    ) {
      return { kind: "refused", reason: "send_in_progress" };
    }
    this.leaseHolder = input.holder;
    this.leaseExpiresAt = input.leaseExpiresAt;
    // --- end critical section -------------------------------------------

    return { kind: "granted", settings: { ...this.settings } };
  }

  async endSend(input: { holder: string }): Promise<void> {
    this.record("endSend");
    if (this.leaseHolder === input.holder) {
      this.leaseHolder = null;
      this.leaseExpiresAt = null;
    }
  }

  async stop(input: { stoppedAt: string; reason: StopReason }): Promise<AutoReplySettings> {
    this.record("stop");
    this.settings = {
      ...this.settings,
      enabled: false,
      stoppedAt: input.stoppedAt,
      stopReason: this.settings.stopReason === "result_unknown" ? "result_unknown" : input.reason,
    };
    return { ...this.settings };
  }

  async claimSend(input: {
    topLevelCommentId: string;
    videoId: string;
    sendDay: string;
    claimedAt: string;
    lockExpiresAt: string;
    reason: string;
  }): Promise<ClaimOutcome> {
    this.record("claimSend");

    // --- one critical section, no await inside ---------------------------
    const existing = this.sends.get(input.topLevelCommentId);
    if (existing !== undefined) {
      // Note what is NOT checked here: lockExpiresAt. A stale claim is still a
      // claim, so an expired lock can never turn into a second send.
      return { kind: "already_recorded", status: existing.status };
    }

    const reservedCount = this.reserved.get(input.sendDay) ?? 0;

    this.sends.set(input.topLevelCommentId, {
      topLevelCommentId: input.topLevelCommentId,
      videoId: input.videoId,
      status: "CLAIMED",
      reason: input.reason,
      replyCommentId: null,
      sendDay: input.sendDay,
      claimedAt: input.claimedAt,
      resolvedAt: null,
      lockExpiresAt: input.lockExpiresAt,
    });
    const next = reservedCount + 1;
    this.reserved.set(input.sendDay, next);
    // --- end critical section -------------------------------------------

    return { kind: "claimed", sendDay: input.sendDay, reservedCount: next };
  }

  async finalizeSent(input: {
    topLevelCommentId: string;
    replyCommentId: string;
    resolvedAt: string;
  }): Promise<void> {
    this.record("finalizeSent");
    const send = this.sends.get(input.topLevelCommentId);
    if (send === undefined || (send.status !== "CLAIMED" && send.status !== "RESULT_UNKNOWN")) {
      return;
    }
    this.sends.set(input.topLevelCommentId, {
      ...send,
      status: "SENT",
      replyCommentId: input.replyCommentId,
      resolvedAt: input.resolvedAt,
    });
  }

  async releaseSend(input: {
    topLevelCommentId: string;
    reason: string;
    resolvedAt: string;
  }): Promise<void> {
    this.record("releaseSend");
    const send = this.sends.get(input.topLevelCommentId);
    // Only a CLAIMED row refunds, which is what stops a double refund and
    // what stops a RESULT_UNKNOWN row from ever giving its slot back.
    if (send === undefined || send.status !== "CLAIMED") {
      return;
    }
    this.sends.set(input.topLevelCommentId, {
      ...send,
      status: "FAILED",
      reason: input.reason,
      resolvedAt: input.resolvedAt,
    });
    const reservedCount = this.reserved.get(send.sendDay) ?? 0;
    this.reserved.set(send.sendDay, Math.max(0, reservedCount - 1));
  }

  async haltOnResultUnknown(input: {
    topLevelCommentId: string;
    reason: string;
    resolvedAt: string;
  }): Promise<AutoReplySettings> {
    this.record("haltOnResultUnknown");
    const send = this.sends.get(input.topLevelCommentId);
    if (send !== undefined && send.status === "CLAIMED") {
      this.sends.set(input.topLevelCommentId, {
        ...send,
        status: "RESULT_UNKNOWN",
        reason: input.reason,
        resolvedAt: input.resolvedAt,
      });
    }
    // The status change and the disable happen together, with no await
    // between them, exactly as the SQL function does them in one transaction.
    // The quota is deliberately untouched, and the lease is dropped so the next
    // caller sees the halt rather than a stale lease.
    this.settings = {
      ...this.settings,
      enabled: false,
      stoppedAt: input.resolvedAt,
      stopReason: "result_unknown",
    };
    this.leaseHolder = null;
    this.leaseExpiresAt = null;
    return { ...this.settings };
  }

  async markUnconfirmedNoReply(input: {
    topLevelCommentId: string;
    resolvedAt: string;
  }): Promise<void> {
    this.record("markUnconfirmedNoReply");
    const send = this.sends.get(input.topLevelCommentId);
    if (send === undefined || (send.status !== "CLAIMED" && send.status !== "RESULT_UNKNOWN")) {
      return;
    }
    this.sends.set(input.topLevelCommentId, {
      ...send,
      status: "UNCONFIRMED_NO_REPLY",
      resolvedAt: input.resolvedAt,
    });
  }

  async listPendingSends(): Promise<SendRecord[]> {
    this.record("listPendingSends");
    return [...this.sends.values()]
      .filter((send) => send.status === "CLAIMED" || send.status === "RESULT_UNKNOWN")
      .sort((left, right) => Date.parse(left.claimedAt) - Date.parse(right.claimedAt))
      .map((send) => ({ ...send }));
  }

  async findRecordedStatuses(
    topLevelCommentIds: readonly string[],
  ): Promise<Map<string, SendStatus>> {
    this.record("findRecordedStatuses");
    const found = new Map<string, SendStatus>();
    for (const id of topLevelCommentIds) {
      const send = this.sends.get(id);
      if (send !== undefined) {
        found.set(id, send.status);
      }
    }
    return found;
  }

  async countDay(sendDay: string): Promise<DayCounts> {
    this.record("countDay");
    let sentCount = 0;
    for (const send of this.sends.values()) {
      if (send.sendDay === sendDay && send.status === "SENT") {
        sentCount += 1;
      }
    }
    return { reservedCount: this.reserved.get(sendDay) ?? 0, sentCount };
  }

  async listRecentConfirmedSends(since: string): Promise<SendRecord[]> {
    return [...this.sends.values()].filter(send => send.status === "SENT" && Date.parse(send.claimedAt) >= Date.parse(since)).sort((a, b) => Date.parse(b.claimedAt) - Date.parse(a.claimedAt)).map(send => ({ ...send }));
  }

  async listRecentSends(limit: number): Promise<SendRecord[]> {
    this.record("listRecentSends");
    return [...this.sends.values()]
      .sort((left, right) => Date.parse(right.claimedAt) - Date.parse(left.claimedAt))
      .slice(0, Math.max(0, limit))
      .map((send) => ({ ...send }));
  }

  async beginRun(input: {
    runId: string;
    trigger: RunTrigger;
    startedAt: string;
  }): Promise<void> {
    this.record("beginRun");
    if (this.runs.some((run) => run.runId === input.runId)) {
      return;
    }
    this.runs.push({
      runId: input.runId,
      trigger: input.trigger,
      startedAt: input.startedAt,
      completedAt: null,
      outcome: null,
      consideredCount: 0,
      deferredCount: 0,
      humanReviewCount: 0,
      failureCount: 0,
      sentCount: 0,
      automationEnabled: false,
      cursorHasMore: false,
    });
  }

  async finishRun(input: {
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
  }): Promise<void> {
    this.record("finishRun");
    const index = this.runs.findIndex((run) => run.runId === input.runId);
    if (index < 0) {
      return;
    }
    const run = this.runs[index];
    if (run === undefined) {
      return;
    }
    this.runs[index] = { ...run, ...input };
  }

  async listRecentRuns(limit: number): Promise<RunRecord[]> {
    this.record("listRecentRuns");
    return [...this.runs].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || b.runId.localeCompare(a.runId))
      .slice(0, Math.min(20, Math.max(0, limit))).map(run => ({ ...run }));
  }

  async readLastRun(): Promise<RunRecord | null> {
    this.record("readLastRun");
    const sorted = [...this.runs].sort(
      (left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt),
    );
    const last = sorted[0];
    return last === undefined ? null : { ...last };
  }

  async purgeExpired(input: { before: string }): Promise<{ purgedCount: number }> {
    this.record("purgeExpired");
    const before = Date.parse(input.before);
    let purgedCount = 0;
    for (const [id, send] of [...this.sends.entries()]) {
      if (Date.parse(send.claimedAt) < before) {
        this.sends.delete(id);
        purgedCount += 1;
      }
    }
    for (let index = this.runs.length - 1; index >= 0; index -= 1) {
      const run = this.runs[index];
      if (run !== undefined && Date.parse(run.startedAt) < before) {
        this.runs.splice(index, 1);
      }
    }
    return { purgedCount };
  }

  // --- test-only helpers ------------------------------------------------

  /** Reads a row without going through the port, for assertions. */
  peek(topLevelCommentId: string): SendRecord | undefined {
    const send = this.sends.get(topLevelCommentId);
    return send === undefined ? undefined : { ...send };
  }

  /** Pre-loads a row, to set up a rerun or a reconciliation test. */
  seedSend(send: SendRecord): void {
    this.sends.set(send.topLevelCommentId, { ...send });
    if (send.status !== "FAILED") {
      this.reserved.set(send.sendDay, (this.reserved.get(send.sendDay) ?? 0) + 1);
    }
  }

  /** Pre-loads the day counter, to set up a daily-limit test. */
  seedReserved(sendDay: string, count: number): void {
    this.reserved.set(sendDay, count);
  }

  /** The current holder of the single send lease, or null. */
  peekLease(): string | null {
    return this.leaseHolder;
  }

  /** How many run records exist, without going through the port. */
  runCount(): number {
    return this.runs.length;
  }

  reservedOn(sendDay: string): number {
    return this.reserved.get(sendDay) ?? 0;
  }

  sendCount(): number {
    return this.sends.size;
  }
}
