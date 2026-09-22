import { requestSignal } from "../execution-budget";
import {
  AutoReplyConfigMissingError,
  AutoReplyStoreRequestError,
  AutoReplyStoreResponseError,
} from "./errors";
import {
  AutoReplySettings,
  AutoReplyStore,
  ClaimOutcome,
  DayCounts,
  RUN_TRIGGERS,
  RunRecord,
  RunTrigger,
  SEND_GATE_REFUSALS,
  SEND_STATUSES,
  SendGate,
  SendGateRefusal,
  SendRecord,
  SendStatus,
  STOP_REASONS,
  StopReason,
} from "./store";

/**
 * The Supabase adapter for AutoReplyStore.
 *
 * Every method is one POST to one database function from
 * supabase/migrations/20260914000000_ch20_auto_reply.sql. Nothing here builds
 * SQL and nothing here does a read-then-write: the decisions that must be
 * atomic are decided inside the database, and this file only carries arguments
 * there and parses what comes back.
 *
 * Secret handling, which is the other reason this file exists rather than a
 * fetch call inline in a route:
 *   - the service role key goes in the apikey and Authorization HEADERS only
 *   - the URL is always ${SUPABASE_URL}/rest/v1/rpc/${fn} with no query string,
 *     so no argument and no key can end up in a proxy or access log
 *   - thrown errors carry the function name and the HTTP status and nothing
 *     else — never the key, the URL, or the response body
 * src/lib/autoreply/supabase-store.test.ts asserts those three properties.
 */

const RPC_PATH_PREFIX = "/rest/v1/rpc/";

/** True only when both required env vars are present, checked before a run starts. */
export function hasAutoReplyStoreConfig(): boolean {
  return Boolean(process.env.SUPABASE_URL) && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function requireConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) {
    throw new AutoReplyConfigMissingError("SUPABASE_URL is not set on the server.");
  }
  if (!key) {
    // The message names the variable, never its value.
    throw new AutoReplyConfigMissingError("SUPABASE_SERVICE_ROLE_KEY is not set on the server.");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { url, key } = requireConfig();

  let response: Response;
  try {
    response = await fetch(`${url}${RPC_PATH_PREFIX}${fn}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: requestSignal(["ch20_finalize_sent", "ch20_release_send", "ch20_halt_on_result_unknown", "ch20_end_send", "ch20_finish_run"].includes(fn) ? "cleanup" : "store"),
      cache: "no-store",
    });
  } catch {
    // The original error's message is not forwarded: a fetch failure message
    // can contain the full URL, and the URL identifies the project.
    throw new AutoReplyStoreRequestError(`${fn} request failed.`);
  }

  if (!response.ok) {
    throw new AutoReplyStoreRequestError(`${fn} returned HTTP ${response.status}.`);
  }

  // PostgREST returns an empty 204 for SQL functions returning void.
  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    throw new AutoReplyStoreResponseError(`${fn} returned a body this app cannot read.`);
  }
}

function asRecord(fn: string, value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AutoReplyStoreResponseError(`${fn} did not return an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(fn: string, value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new AutoReplyStoreResponseError(`${fn} did not return a list.`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function requiredString(fn: string, field: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AutoReplyStoreResponseError(`${fn} returned no ${field}.`);
  }
  return value;
}

function requiredNumber(fn: string, field: string, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AutoReplyStoreResponseError(`${fn} returned no ${field}.`);
  }
  return value;
}

/**
 * A status outside the closed set is rejected rather than passed through. If
 * someone adds a status to the database without adding it here, this app stops
 * instead of treating an unknown state as safe.
 */
function asSendStatus(fn: string, value: unknown): SendStatus {
  if (typeof value === "string" && (SEND_STATUSES as readonly string[]).includes(value)) {
    return value as SendStatus;
  }
  throw new AutoReplyStoreResponseError(`${fn} returned an unknown send status.`);
}

function asStopReason(value: unknown): StopReason | null {
  if (typeof value === "string" && (STOP_REASONS as readonly string[]).includes(value)) {
    return value as StopReason;
  }
  return null;
}

function parseSettings(fn: string, value: unknown): AutoReplySettings {
  const row = asRecord(fn, value);
  return {
    // Anything other than a literal true is off. A missing or unexpected value
    // must never read as enabled.
    enabled: row.enabled === true,
    channelId: optionalString(row.channelId),
    videoId: optionalString(row.videoId),
    activatedAt: optionalString(row.activatedAt),
    stoppedAt: optionalString(row.stoppedAt),
    stopReason: asStopReason(row.stopReason),
    cursorPageToken: optionalString(row.cursorPageToken),
    cursorUpdatedAt: optionalString(row.cursorUpdatedAt),
  };
}

/**
 * A refusal reason outside the closed set is not passed through, and a body
 * that is neither granted nor a known refusal is an error rather than a
 * permission. The safe default is "you may not send".
 */
function parseSendGate(value: unknown): SendGate {
  const fn = "ch20_begin_send";
  const row = asRecord(fn, value);
  if (row.kind === "granted") {
    return { kind: "granted", settings: parseSettings(fn, row.settings) };
  }
  if (
    row.kind === "refused" &&
    typeof row.reason === "string" &&
    (SEND_GATE_REFUSALS as readonly string[]).includes(row.reason)
  ) {
    return { kind: "refused", reason: row.reason as SendGateRefusal };
  }
  throw new AutoReplyStoreResponseError(`${fn} returned an unknown outcome.`);
}

function asRunTrigger(fn: string, value: unknown): RunTrigger {
  if (typeof value === "string" && (RUN_TRIGGERS as readonly string[]).includes(value)) {
    return value as RunTrigger;
  }
  throw new AutoReplyStoreResponseError(`${fn} returned an unknown run trigger.`);
}

function countField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function parseRunRecord(fn: string, value: unknown): RunRecord {
  const row = asRecord(fn, value);
  return {
    runId: requiredString(fn, "runId", row.runId),
    trigger: asRunTrigger(fn, row.trigger),
    startedAt: requiredString(fn, "startedAt", row.startedAt),
    completedAt: optionalString(row.completedAt),
    outcome: optionalString(row.outcome),
    consideredCount: countField(row.consideredCount),
    deferredCount: countField(row.deferredCount),
    humanReviewCount: countField(row.humanReviewCount),
    failureCount: countField(row.failureCount),
    sentCount: countField(row.sentCount),
    automationEnabled: row.automationEnabled === true,
    cursorHasMore: row.cursorHasMore === true,
  };
}

function parseSendRecord(fn: string, value: unknown): SendRecord {
  const row = asRecord(fn, value);
  return {
    topLevelCommentId: requiredString(fn, "topLevelCommentId", row.topLevelCommentId),
    videoId: requiredString(fn, "videoId", row.videoId),
    status: asSendStatus(fn, row.status),
    reason: optionalString(row.reason),
    replyCommentId: optionalString(row.replyCommentId),
    sendDay: requiredString(fn, "sendDay", row.sendDay),
    claimedAt: requiredString(fn, "claimedAt", row.claimedAt),
    resolvedAt: optionalString(row.resolvedAt),
    lockExpiresAt: requiredString(fn, "lockExpiresAt", row.lockExpiresAt),
  };
}

function parseClaimOutcome(value: unknown): ClaimOutcome {
  const fn = "ch20_claim_send";
  const row = asRecord(fn, value);
  const kind = row.kind;
  if (kind === "claimed") {
    return {
      kind: "claimed",
      sendDay: requiredString(fn, "sendDay", row.sendDay),
      reservedCount: requiredNumber(fn, "reservedCount", row.reservedCount),
    };
  }
  if (kind === "already_recorded") {
    return { kind: "already_recorded", status: asSendStatus(fn, row.status) };
  }
  // An unrecognized outcome is never optimistically treated as a claim.
  throw new AutoReplyStoreResponseError(`${fn} returned an unknown outcome.`);
}

export function createSupabaseAutoReplyStore(): AutoReplyStore {
  return {
    async readSettings(): Promise<AutoReplySettings> {
      return parseSettings("ch20_read_settings", await callRpc("ch20_read_settings", {}));
    },

    async prepareTarget(input): Promise<AutoReplySettings> {
      return parseSettings(
        "ch20_prepare_target",
        await callRpc("ch20_prepare_target", {
          p_channel_id: input.channelId,
          p_video_id: input.videoId,
          p_activated_at: input.activatedAt,
        }),
      );
    },

    async enableSchedule(input): Promise<AutoReplySettings> {
      return parseSettings(
        "ch20_enable_schedule",
        await callRpc("ch20_enable_schedule", { p_at: input.at, p_video_id: input.videoId, p_activated_at: input.activatedAt }),
      );
    },

    async stop(input): Promise<AutoReplySettings> {
      return parseSettings(
        "ch20_stop",
        await callRpc("ch20_stop", {
          p_stopped_at: input.stoppedAt,
          p_reason: input.reason,
        }),
      );
    },

    async saveCursor(input): Promise<void> {
      await callRpc("ch20_save_cursor", {
        p_page_token: input.pageToken,
        p_at: input.at,
      });
    },

    async beginSend(input): Promise<SendGate> {
      return parseSendGate(
        await callRpc("ch20_begin_send", {
          p_holder: input.holder,
          p_require_enabled: input.requireEnabled,
          p_now: input.now,
          p_lease_expires_at: input.leaseExpiresAt,
        }),
      );
    },

    async endSend(input): Promise<void> {
      await callRpc("ch20_end_send", { p_holder: input.holder });
    },

    async claimSend(input): Promise<ClaimOutcome> {
      return parseClaimOutcome(
        await callRpc("ch20_claim_send", {
          p_top_level_comment_id: input.topLevelCommentId,
          p_video_id: input.videoId,
          p_send_day: input.sendDay,
          p_claimed_at: input.claimedAt,
          p_lock_expires_at: input.lockExpiresAt,
          p_reason: input.reason,
        }),
      );
    },

    async finalizeSent(input): Promise<void> {
      await callRpc("ch20_finalize_sent", {
        p_top_level_comment_id: input.topLevelCommentId,
        p_reply_comment_id: input.replyCommentId,
        p_resolved_at: input.resolvedAt,
      });
    },

    async releaseSend(input): Promise<void> {
      await callRpc("ch20_release_send", {
        p_top_level_comment_id: input.topLevelCommentId,
        p_reason: input.reason,
        p_resolved_at: input.resolvedAt,
      });
    },

    async haltOnResultUnknown(input): Promise<AutoReplySettings> {
      return parseSettings(
        "ch20_halt_on_result_unknown",
        await callRpc("ch20_halt_on_result_unknown", {
          p_top_level_comment_id: input.topLevelCommentId,
          p_reason: input.reason,
          p_resolved_at: input.resolvedAt,
        }),
      );
    },

    async markUnconfirmedNoReply(input): Promise<void> {
      await callRpc("ch20_mark_unconfirmed_no_reply", {
        p_top_level_comment_id: input.topLevelCommentId,
        p_resolved_at: input.resolvedAt,
      });
    },

    async listPendingSends(): Promise<SendRecord[]> {
      const rows = asArray("ch20_list_pending_sends", await callRpc("ch20_list_pending_sends", {}));
      return rows.map((row) => parseSendRecord("ch20_list_pending_sends", row));
    },

    async findRecordedStatuses(topLevelCommentIds): Promise<Map<string, SendStatus>> {
      const fn = "ch20_find_recorded_statuses";
      if (topLevelCommentIds.length === 0) {
        return new Map();
      }
      const row = asRecord(fn, await callRpc(fn, { p_ids: [...topLevelCommentIds] }));
      const found = new Map<string, SendStatus>();
      for (const [id, status] of Object.entries(row)) {
        found.set(id, asSendStatus(fn, status));
      }
      return found;
    },

    async countDay(sendDay): Promise<DayCounts> {
      const fn = "ch20_count_day";
      const row = asRecord(fn, await callRpc(fn, { p_send_day: sendDay }));
      return {
        reservedCount: requiredNumber(fn, "reservedCount", row.reservedCount),
        sentCount: requiredNumber(fn, "sentCount", row.sentCount),
      };
    },

    async listRecentConfirmedSends(since): Promise<SendRecord[]> {
      const fn = "ch20_list_recent_confirmed_sends";
      return asArray(fn, await callRpc(fn, { p_since: since })).map(row => parseSendRecord(fn, row));
    },

    async listRecentSends(limit): Promise<SendRecord[]> {
      const fn = "ch20_list_recent_sends";
      const rows = asArray(fn, await callRpc(fn, { p_limit: limit }));
      return rows.map((row) => parseSendRecord(fn, row));
    },

    async beginRun(input): Promise<void> {
      await callRpc("ch20_begin_run", {
        p_run_id: input.runId,
        p_trigger: input.trigger,
        p_started_at: input.startedAt,
      });
    },

    async finishRun(input): Promise<void> {
      await callRpc("ch20_finish_run", {
        p_run_id: input.runId,
        p_completed_at: input.completedAt,
        p_outcome: input.outcome,
        p_considered_count: input.consideredCount,
        p_deferred_count: input.deferredCount,
        p_human_review_count: input.humanReviewCount,
        p_failure_count: input.failureCount,
        p_sent_count: input.sentCount,
        p_automation_enabled: input.automationEnabled,
        p_cursor_has_more: input.cursorHasMore,
      });
    },

    async listRecentRuns(limit): Promise<RunRecord[]> {
      const fn = "ch20_list_recent_runs";
      const value = await callRpc(fn, { p_limit: Math.min(20, Math.max(0, limit)) });
      if (!Array.isArray(value)) throw new AutoReplyStoreResponseError(fn);
      return value.map(row => parseRunRecord(fn, row));
    },

    async readLastRun(): Promise<RunRecord | null> {
      const fn = "ch20_read_last_run";
      const value = await callRpc(fn, {});
      // No run on record yet: the function selects no row and returns null.
      if (value === null) {
        return null;
      }
      return parseRunRecord(fn, value);
    },

    async purgeExpired(input): Promise<{ purgedCount: number }> {
      const fn = "ch20_purge_expired";
      const row = asRecord(fn, await callRpc(fn, { p_before: input.before }));
      return { purgedCount: requiredNumber(fn, "purgedCount", row.purgedCount) };
    },
  };
}
