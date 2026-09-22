-- Chapter 20 — bounded auto replies: server-only state.
--
-- Four tables and the functions that change them. Every state change a run
-- makes goes through one of these functions, because the safety properties
-- (one reply per comment, five per Asia/Seoul day, no refund on an unobserved
-- result, one send at a time) only hold if the check and the write happen in
-- the same statement. A read followed by a separate write from the application
-- would let two concurrent runs both pass the same check.
--
-- WHAT IS NOT HERE: no column holds comment text, a commenter's name or
-- channel, or the reply text this app generated. Only YouTube ids, an opaque
-- page cursor, a status from a closed set, short reason and outcome labels,
-- counts, and timestamps. ch20_purge_expired caps even those at 30 days.
--
-- This file contains no secret value. The service role key is sent as an HTTP
-- header by the server (see src/lib/autoreply/supabase-store.ts) and never
-- appears in SQL, in a URL, or in a log.

-- ---------------------------------------------------------------------------
-- Settings: exactly one row, and it starts OFF.
-- ---------------------------------------------------------------------------
create table if not exists ch20_auto_reply_settings (
  id text primary key default 'default' check (id = 'default'),
  -- The SCHEDULE switch. The default and the safe final state are both false.
  -- Nothing is sent on a timer until a person turns it on, and any halt
  -- returns this to false. A single manually approved send does not read it.
  enabled boolean not null default false,
  channel_id text,
  video_id text,
  -- The baseline. Only comments published strictly after this instant are ever
  -- answered, which is why preparing a target can only send zero replies.
  -- ch20_prepare_target writes it ONCE per channel+video pair and preserves it
  -- afterwards, so stopping and resuming does not move the floor forward and
  -- silently skip everything that arrived while the schedule was off.
  activated_at timestamptz,
  stopped_at timestamptz,
  stop_reason text check (stop_reason in ('manual', 'result_unknown')),
  -- Where the last run stopped walking commentThreads.list pages, so the next
  -- run continues past the newest 20 instead of re-reading them. An opaque
  -- token from the API; null means "start from the newest page again".
  cursor_page_token text,
  cursor_updated_at timestamptz,
  -- The single global send lease. Held for the few seconds around one
  -- comments.insert so two runs can never be between their own last check and
  -- their own write at the same time. See ch20_begin_send.
  send_lease_holder text,
  send_lease_expires_at timestamptz,
  updated_at timestamptz not null default now()
);

insert into ch20_auto_reply_settings (id) values ('default')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Sends: one row per top-level comment, forever the duplicate guard.
-- ---------------------------------------------------------------------------
create table if not exists ch20_auto_reply_sends (
  -- The primary key IS the idempotency key. A second attempt on the same
  -- comment cannot insert, whatever the first attempt's outcome was.
  top_level_comment_id text primary key,
  video_id text not null,
  status text not null check (
    status in ('CLAIMED', 'SENT', 'RESULT_UNKNOWN', 'UNCONFIRMED_NO_REPLY', 'FAILED')
  ),
  -- A short label from the application's closed set (a category name or a
  -- failure reason). Never free text from YouTube, Gemini, or a commenter.
  reason text,
  reply_comment_id text,
  send_day date not null,
  claimed_at timestamptz not null,
  resolved_at timestamptz,
  -- Marks a claim as stale enough to be worth reconciling against
  -- comments.list. Expiry alone is NEVER permission to send again — the row
  -- above is what prevents that, and it does not expire.
  lock_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists ch20_auto_reply_sends_created_at_idx
  on ch20_auto_reply_sends (created_at);
create index if not exists ch20_auto_reply_sends_status_idx
  on ch20_auto_reply_sends (status);
create index if not exists ch20_auto_reply_sends_send_day_idx
  on ch20_auto_reply_sends (send_day);

-- ---------------------------------------------------------------------------
-- Daily quota: one row per Asia/Seoul day, the global counter.
-- ---------------------------------------------------------------------------
create table if not exists ch20_auto_reply_daily_quota (
  -- The day string the application computed in Asia/Seoul, so the limit does
  -- not move when the server's own timezone differs.
  send_day date primary key,
  reserved_count integer not null default 0 check (reserved_count >= 0)
);

-- ---------------------------------------------------------------------------
-- Runs: one operational record per run, so "did the timer actually reach the
-- server, and what did the server do" is answerable.
--
-- Three different things can fail and they must not be confused: registering
-- the schedule (Supabase side), the HTTP request arriving (a row appears here
-- with started_at), and the server finishing its work (completed_at and an
-- outcome label). Counts only — no comment, no author, no reply text.
-- ---------------------------------------------------------------------------
create table if not exists ch20_auto_reply_runs (
  run_id text primary key,
  run_trigger text not null check (run_trigger in ('scheduled', 'manual')),
  started_at timestamptz not null,
  -- Null while a run is in flight, and still null if the process died mid-run.
  completed_at timestamptz,
  -- One label from the application's closed outcome set.
  outcome text,
  considered_count integer not null default 0,
  deferred_count integer not null default 0,
  human_review_count integer not null default 0,
  failure_count integer not null default 0,
  sent_count integer not null default 0,
  automation_enabled boolean not null default false,
  cursor_has_more boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ch20_auto_reply_runs_started_at_idx
  on ch20_auto_reply_runs (started_at desc);
create index if not exists ch20_auto_reply_runs_created_at_idx
  on ch20_auto_reply_runs (created_at);

-- ---------------------------------------------------------------------------
-- Access: server (service role) only.
-- RLS on with no policy means anon and authenticated can read nothing, even
-- if a key for them ever leaks. The service role bypasses RLS and is only
-- ever used from the server.
-- ---------------------------------------------------------------------------
alter table ch20_auto_reply_settings enable row level security;
alter table ch20_auto_reply_sends enable row level security;
alter table ch20_auto_reply_daily_quota enable row level security;
alter table ch20_auto_reply_runs enable row level security;

revoke all on ch20_auto_reply_settings from anon, authenticated;
revoke all on ch20_auto_reply_sends from anon, authenticated;
revoke all on ch20_auto_reply_daily_quota from anon, authenticated;
revoke all on ch20_auto_reply_runs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Settings functions
-- ---------------------------------------------------------------------------
create or replace function ch20_read_settings()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', enabled,
    'channelId', channel_id,
    'videoId', video_id,
    'activatedAt', activated_at,
    'stoppedAt', stopped_at,
    'stopReason', stop_reason,
    'cursorPageToken', cursor_page_token,
    'cursorUpdatedAt', cursor_updated_at
  )
  from ch20_auto_reply_settings
  where id = 'default';
$$;

-- Step 1 of three: name the target. Records the approved channel and video
-- and, the FIRST time this pair is prepared, the baseline instant.
--
-- Preparing the same pair again keeps the original baseline and the page
-- cursor. That is the whole point: after a stop, after a halt, and after a
-- redeploy, "prepare again" must not move the floor forward, because moving it
-- would silently drop every comment that arrived in between. Recovery after a
-- halt is safe without moving it — the unconfirmed comment's send row is
-- permanent, so ch20_claim_send keeps answering already_recorded for it.
--
-- This does NOT turn the schedule on, does NOT clear a halt, and sends nothing.
create or replace function ch20_prepare_target(
  p_channel_id text,
  p_video_id text,
  p_activated_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_settings
     set enabled = case when channel_id = p_channel_id and video_id = p_video_id then enabled else false end,
         channel_id = p_channel_id,
         video_id = p_video_id,
         activated_at = case
           when channel_id = p_channel_id
                and video_id = p_video_id
                and activated_at is not null
             then activated_at
           else p_activated_at
         end,
         -- A different video starts its own page walk.
         cursor_page_token = case
           when video_id = p_video_id then cursor_page_token else null
         end,
         cursor_updated_at = case
           when video_id = p_video_id then cursor_updated_at else null
         end,
         updated_at = now()
   where id = 'default' and send_lease_holder is null and stop_reason is distinct from 'result_unknown';
  select ch20_read_settings();
$$;

-- Step 3 of three: turn the SCHEDULE on for an already-prepared target.
--
-- The where clause is the guard: with no channel, video, and baseline stored,
-- nothing happens and the caller reads back enabled = false. The baseline is
-- untouched here, so enabling never moves the floor.
create or replace function ch20_enable_schedule(p_at timestamptz, p_video_id text, p_activated_at timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_settings
     set enabled = true,
         stopped_at = null,
         stop_reason = null,
         updated_at = p_at
   where id = 'default'
     and channel_id is not null
     and video_id = p_video_id
     and activated_at = p_activated_at
     and stop_reason is distinct from 'result_unknown'
     and send_lease_holder is null;
  select ch20_read_settings();
$$;

-- Turns the schedule off. A manually approved single send is deliberately
-- still possible after this: 'manual' means "stop the timer", while
-- 'result_unknown' (below) means "stop everything until a person looks".
create or replace function ch20_stop(
  p_stopped_at timestamptz,
  p_reason text
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_settings
     set enabled = false,
         stopped_at = p_stopped_at,
         stop_reason = case when stop_reason = 'result_unknown' then stop_reason else p_reason end,
         updated_at = now()
   where id = 'default';
  select ch20_read_settings();
$$;

-- Remembers where the comment walk stopped. Passing null clears it, which is
-- also how a run reports "there is nothing further back worth reading".
create or replace function ch20_save_cursor(
  p_page_token text,
  p_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_settings
     set cursor_page_token = p_page_token,
         cursor_updated_at = p_at,
         updated_at = now()
   where id = 'default';
$$;

-- ---------------------------------------------------------------------------
-- The send gate: re-check the state and take the one global lease, together.
--
-- Called immediately before ch20_claim_send, and released by ch20_end_send
-- once the send has settled. `for update` on the settings row makes two callers
-- queue rather than interleave, so at most one send is ever in flight.
--
-- This is what closes the race the fail-stop would otherwise lose. Without it,
-- two runs could both read "enabled, not halted", then one could halt on an
-- unobserved result while the other, already past its check, goes on to call
-- comments.insert. Here the second run cannot even reach its claim: the first
-- run holds the lease until after it has halted, and then the halt itself is
-- what the second run sees.
-- ---------------------------------------------------------------------------
create or replace function ch20_begin_send(
  p_holder text,
  p_require_enabled boolean,
  p_now timestamptz,
  p_lease_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row ch20_auto_reply_settings;
begin
  select * into v_row
    from ch20_auto_reply_settings
   where id = 'default'
     for update;

  if not found then
    return jsonb_build_object('kind', 'refused', 'reason', 'not_prepared');
  end if;

  -- A halt outranks everything, including a manual approval.
  if coalesce(v_row.stop_reason, '') = 'result_unknown' then
    return jsonb_build_object('kind', 'refused', 'reason', 'halted');
  end if;

  if v_row.channel_id is null or v_row.video_id is null or v_row.activated_at is null then
    return jsonb_build_object('kind', 'refused', 'reason', 'not_prepared');
  end if;

  -- Only a scheduled run needs the schedule to be on.
  if p_require_enabled and not v_row.enabled then
    return jsonb_build_object('kind', 'refused', 'reason', 'automation_off');
  end if;

  -- Any unreleased lease blocks another send, even after its deadline. The
  -- deadline is diagnostic only; a crashed process requires human review.
  if v_row.send_lease_holder is not null
     and v_row.send_lease_holder <> p_holder then
    return jsonb_build_object('kind', 'refused', 'reason', 'send_in_progress');
  end if;

  update ch20_auto_reply_settings
     set send_lease_holder = p_holder,
         send_lease_expires_at = p_lease_expires_at,
         updated_at = now()
   where id = 'default';

  return jsonb_build_object('kind', 'granted', 'settings', ch20_read_settings());
end;
$$;

-- Releases the lease, and only if this holder still owns it — a caller whose
-- identity differs must not clear the owner's lease.
create or replace function ch20_end_send(p_holder text)
returns void
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_settings
     set send_lease_holder = null,
         send_lease_expires_at = null,
         updated_at = now()
   where id = 'default'
     and send_lease_holder = p_holder;
$$;

-- ---------------------------------------------------------------------------
-- The atomic claim.
--
-- This is the whole per-comment concurrency story. Inside one transaction it:
-- refuses a comment that already has a row, takes a row lock on today's
-- counter so concurrent claims serialize, refuses once the counter reached the
-- limit, then inserts the send row and increments the counter together.
--
-- Two claims for DIFFERENT comments at the same moment both wait on the same
-- quota row, so the fifth and sixth of the day cannot both succeed. Two claims
-- for the SAME comment are separated by the primary key, and the
-- unique_violation handler turns the loser into already_recorded rather than
-- an error.
-- ---------------------------------------------------------------------------
create or replace function ch20_claim_send(
  p_top_level_comment_id text,
  p_video_id text,
  p_send_day date,
  p_daily_limit integer,
  p_claimed_at timestamptz,
  p_lock_expires_at timestamptz,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reserved integer;
begin
  select status into v_status
    from ch20_auto_reply_sends
   where top_level_comment_id = p_top_level_comment_id;
  if v_status is not null then
    return jsonb_build_object('kind', 'already_recorded', 'status', v_status);
  end if;

  insert into ch20_auto_reply_daily_quota (send_day, reserved_count)
       values (p_send_day, 0)
  on conflict (send_day) do nothing;

  -- for update is what serializes concurrent claims for the same day.
  select reserved_count into v_reserved
    from ch20_auto_reply_daily_quota
   where send_day = p_send_day
     for update;

  if v_reserved >= p_daily_limit then
    return jsonb_build_object(
      'kind', 'daily_limit_reached',
      'sendDay', p_send_day,
      'reservedCount', v_reserved
    );
  end if;

  insert into ch20_auto_reply_sends (
    top_level_comment_id, video_id, status, reason,
    send_day, claimed_at, lock_expires_at
  ) values (
    p_top_level_comment_id, p_video_id, 'CLAIMED', p_reason,
    p_send_day, p_claimed_at, p_lock_expires_at
  );

  update ch20_auto_reply_daily_quota
     set reserved_count = reserved_count + 1
   where send_day = p_send_day
  returning reserved_count into v_reserved;

  return jsonb_build_object(
    'kind', 'claimed',
    'sendDay', p_send_day,
    'reservedCount', v_reserved
  );
exception
  when unique_violation then
    select status into v_status
      from ch20_auto_reply_sends
     where top_level_comment_id = p_top_level_comment_id;
    return jsonb_build_object('kind', 'already_recorded', 'status', coalesce(v_status, 'CLAIMED'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Settling a claim.
-- ---------------------------------------------------------------------------

-- Confirmed. Quota is untouched: the slot was already spent when claimed.
-- Also accepts a RESULT_UNKNOWN row, which is how a reconciled send that did
-- land gets recorded with the reply id found on comments.list.
create or replace function ch20_finalize_sent(
  p_top_level_comment_id text,
  p_reply_comment_id text,
  p_resolved_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_sends
     set status = 'SENT',
         reply_comment_id = p_reply_comment_id,
         resolved_at = p_resolved_at
   where top_level_comment_id = p_top_level_comment_id
     and status in ('CLAIMED', 'RESULT_UNKNOWN');
$$;

-- Refund. Only for a send YouTube refused before creating anything, so the
-- reply provably does not exist. The guard on status = 'CLAIMED' means this
-- can never double-refund, and it can never touch a RESULT_UNKNOWN row.
create or replace function ch20_release_send(
  p_top_level_comment_id text,
  p_reason text,
  p_resolved_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_send_day date;
begin
  update ch20_auto_reply_sends
     set status = 'FAILED',
         reason = p_reason,
         resolved_at = p_resolved_at
   where top_level_comment_id = p_top_level_comment_id
     and status = 'CLAIMED'
  returning send_day into v_send_day;

  if v_send_day is null then
    return;
  end if;

  update ch20_auto_reply_daily_quota
     set reserved_count = greatest(reserved_count - 1, 0)
   where send_day = v_send_day;
end;
$$;

-- The fail-stop. One transaction marks the send unobserved AND turns
-- automation off, with NO refund, and drops the send lease so the next caller
-- sees the halt rather than a stale lease. Splitting this into two calls would
-- leave automation running if the process died in between, which is exactly
-- the case where sending again could duplicate a reply.
create or replace function ch20_halt_on_result_unknown(
  p_top_level_comment_id text,
  p_reason text,
  p_resolved_at timestamptz
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_sends
     set status = 'RESULT_UNKNOWN',
         reason = p_reason,
         resolved_at = p_resolved_at
   where top_level_comment_id = p_top_level_comment_id
     and status = 'CLAIMED';

  update ch20_auto_reply_settings
     set enabled = false,
         stopped_at = p_resolved_at,
         stop_reason = 'result_unknown',
         send_lease_holder = null,
         send_lease_expires_at = null,
         updated_at = now()
   where id = 'default';

  select ch20_read_settings();
$$;

-- Every page of the parent comment's replies was read and none was ours.
-- Still no refund and still never re-sent automatically: the row stays, so
-- ch20_claim_send keeps answering already_recorded. A person decides.
create or replace function ch20_mark_unconfirmed_no_reply(
  p_top_level_comment_id text,
  p_resolved_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_sends
     set status = 'UNCONFIRMED_NO_REPLY',
         resolved_at = p_resolved_at
   where top_level_comment_id = p_top_level_comment_id
     and status in ('CLAIMED', 'RESULT_UNKNOWN');
$$;

-- ---------------------------------------------------------------------------
-- Run records
-- ---------------------------------------------------------------------------

-- Written before any work, so a row appearing here is proof the scheduler's
-- HTTP request actually arrived — separate from whether the work finished.
create or replace function ch20_begin_run(
  p_run_id text,
  p_trigger text,
  p_started_at timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into ch20_auto_reply_runs (run_id, run_trigger, started_at)
       values (p_run_id, p_trigger, p_started_at)
  on conflict (run_id) do nothing;
$$;

create or replace function ch20_finish_run(
  p_run_id text,
  p_completed_at timestamptz,
  p_outcome text,
  p_considered_count integer,
  p_deferred_count integer,
  p_human_review_count integer,
  p_failure_count integer,
  p_sent_count integer,
  p_automation_enabled boolean,
  p_cursor_has_more boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  update ch20_auto_reply_runs
     set completed_at = p_completed_at,
         outcome = p_outcome,
         considered_count = p_considered_count,
         deferred_count = p_deferred_count,
         human_review_count = p_human_review_count,
         failure_count = p_failure_count,
         sent_count = p_sent_count,
         automation_enabled = p_automation_enabled,
         cursor_has_more = p_cursor_has_more
   where run_id = p_run_id;
$$;

create or replace function ch20_read_last_run()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'runId', run_id,
           'trigger', run_trigger,
           'startedAt', started_at,
           'completedAt', completed_at,
           'outcome', outcome,
           'consideredCount', considered_count,
           'deferredCount', deferred_count,
           'humanReviewCount', human_review_count,
           'failureCount', failure_count,
           'sentCount', sent_count,
           'automationEnabled', automation_enabled,
           'cursorHasMore', cursor_has_more
         )
    from ch20_auto_reply_runs
   order by started_at desc
   limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function ch20_list_pending_sends()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_json order by claimed_at), '[]'::jsonb)
  from (
    select claimed_at, jsonb_build_object(
             'topLevelCommentId', top_level_comment_id,
             'videoId', video_id,
             'status', status,
             'reason', reason,
             'replyCommentId', reply_comment_id,
             'sendDay', send_day,
             'claimedAt', claimed_at,
             'resolvedAt', resolved_at,
             'lockExpiresAt', lock_expires_at
           ) as row_json
      from ch20_auto_reply_sends
     where status in ('CLAIMED', 'RESULT_UNKNOWN')
  ) as pending;
$$;

create or replace function ch20_find_recorded_statuses(p_ids text[])
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(top_level_comment_id, status), '{}'::jsonb)
    from ch20_auto_reply_sends
   where top_level_comment_id = any(p_ids);
$$;

create or replace function ch20_count_day(p_send_day date)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'reservedCount', coalesce(
      (select reserved_count from ch20_auto_reply_daily_quota where send_day = p_send_day), 0
    ),
    'sentCount', (
      select count(*) from ch20_auto_reply_sends
       where send_day = p_send_day and status = 'SENT'
    )
  );
$$;

create or replace function ch20_list_recent_sends(p_limit integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_json order by claimed_at desc), '[]'::jsonb)
  from (
    select claimed_at, jsonb_build_object(
             'topLevelCommentId', top_level_comment_id,
             'videoId', video_id,
             'status', status,
             'reason', reason,
             'replyCommentId', reply_comment_id,
             'sendDay', send_day,
             'claimedAt', claimed_at,
             'resolvedAt', resolved_at,
             'lockExpiresAt', lock_expires_at
           ) as row_json
      from ch20_auto_reply_sends
     order by claimed_at desc
     limit greatest(p_limit, 0)
  ) as recent;
$$;

-- ---------------------------------------------------------------------------
-- Retention: 30 days, and nothing survives it.
--
-- Deleting an old SENT row does not reopen a duplicate risk, because a run
-- only ever considers comments published within the last 7 days — a comment
-- whose send row is 30 days old can no longer be selected at all.
--
-- The scheduled run calls this on EVERY path, including the ones that return
-- early because the schedule is off, no target is prepared, or the comment
-- list came back empty. Purging only at the end of a successful run would mean
-- a server that is switched off for a month keeps its rows for a month.
-- ---------------------------------------------------------------------------
create or replace function ch20_purge_expired(p_before timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purged integer;
begin
  delete from ch20_auto_reply_sends where created_at < p_before;
  get diagnostics v_purged = row_count;

  delete from ch20_auto_reply_runs where created_at < p_before;

  delete from ch20_auto_reply_daily_quota
   where send_day < (p_before at time zone 'Asia/Seoul')::date;

  return jsonb_build_object('purgedCount', v_purged);
end;
$$;

-- ---------------------------------------------------------------------------
-- Who may CALL these functions: the server's service role, and nobody else.
--
-- This block is not decoration. create function grants EXECUTE to PUBLIC by
-- default, and every function above is security definer, which means it
-- bypasses the row level security switched on earlier. Without these revokes,
-- anyone holding the project's publishable anon key could POST to
-- /rest/v1/rpc/ch20_enable_schedule and turn the timer on, or call
-- ch20_claim_send and burn the day's five slots — the application's checks
-- would never even be reached. Revoking first and granting service_role
-- explicitly is what makes "server only" a fact rather than an intention.
--
-- src/lib/autoreply/store-permissions.test.ts checks that every function
-- declared in this file appears in both lists below.
-- ---------------------------------------------------------------------------
revoke execute on function ch20_read_settings() from public, anon, authenticated;
revoke execute on function ch20_prepare_target(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_enable_schedule(timestamptz, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_stop(timestamptz, text) from public, anon, authenticated;
revoke execute on function ch20_save_cursor(text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_begin_send(text, boolean, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_end_send(text) from public, anon, authenticated;
revoke execute on function ch20_claim_send(text, text, date, integer, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke execute on function ch20_finalize_sent(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_release_send(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_halt_on_result_unknown(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_mark_unconfirmed_no_reply(text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_begin_run(text, text, timestamptz) from public, anon, authenticated;
revoke execute on function ch20_finish_run(text, timestamptz, text, integer, integer, integer, integer, integer, boolean, boolean) from public, anon, authenticated;
revoke execute on function ch20_read_last_run() from public, anon, authenticated;
revoke execute on function ch20_list_pending_sends() from public, anon, authenticated;
revoke execute on function ch20_find_recorded_statuses(text[]) from public, anon, authenticated;
revoke execute on function ch20_count_day(date) from public, anon, authenticated;
revoke execute on function ch20_list_recent_sends(integer) from public, anon, authenticated;
revoke execute on function ch20_purge_expired(timestamptz) from public, anon, authenticated;

grant execute on function ch20_read_settings() to service_role;
grant execute on function ch20_prepare_target(text, text, timestamptz) to service_role;
grant execute on function ch20_enable_schedule(timestamptz, text, timestamptz) to service_role;
grant execute on function ch20_stop(timestamptz, text) to service_role;
grant execute on function ch20_save_cursor(text, timestamptz) to service_role;
grant execute on function ch20_begin_send(text, boolean, timestamptz, timestamptz) to service_role;
grant execute on function ch20_end_send(text) to service_role;
grant execute on function ch20_claim_send(text, text, date, integer, timestamptz, timestamptz, text) to service_role;
grant execute on function ch20_finalize_sent(text, text, timestamptz) to service_role;
grant execute on function ch20_release_send(text, text, timestamptz) to service_role;
grant execute on function ch20_halt_on_result_unknown(text, text, timestamptz) to service_role;
grant execute on function ch20_mark_unconfirmed_no_reply(text, timestamptz) to service_role;
grant execute on function ch20_begin_run(text, text, timestamptz) to service_role;
grant execute on function ch20_finish_run(text, timestamptz, text, integer, integer, integer, integer, integer, boolean, boolean) to service_role;
grant execute on function ch20_read_last_run() to service_role;
grant execute on function ch20_list_pending_sends() to service_role;
grant execute on function ch20_find_recorded_statuses(text[]) to service_role;
grant execute on function ch20_count_day(date) to service_role;
grant execute on function ch20_list_recent_sends(integer) to service_role;
grant execute on function ch20_purge_expired(timestamptz) to service_role;

create or replace function ch20_list_recent_runs(p_limit integer)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_json), '[]'::jsonb) from (
  select jsonb_build_object(
           'runId', run_id,
           'trigger', run_trigger,
           'startedAt', started_at,
           'completedAt', completed_at,
           'outcome', outcome,
           'consideredCount', considered_count,
           'deferredCount', deferred_count,
           'humanReviewCount', human_review_count,
           'failureCount', failure_count,
           'sentCount', sent_count,
           'automationEnabled', automation_enabled,
           'cursorHasMore', cursor_has_more
         ) as row_json
    from ch20_auto_reply_runs
   order by started_at desc, run_id desc
   limit least(20, greatest(0, p_limit))
  ) as recent;
$$;
revoke execute on function ch20_list_recent_runs(integer) from public, anon, authenticated;
grant execute on function ch20_list_recent_runs(integer) to service_role;

create or replace function ch20_list_recent_confirmed_sends(p_since timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(row_json order by claimed_at desc), '[]'::jsonb)
  from (
    select claimed_at, jsonb_build_object(
             'topLevelCommentId', top_level_comment_id,
             'videoId', video_id,
             'status', status,
             'reason', reason,
             'replyCommentId', reply_comment_id,
             'sendDay', send_day,
             'claimedAt', claimed_at,
             'resolvedAt', resolved_at,
             'lockExpiresAt', lock_expires_at
           ) as row_json
      from ch20_auto_reply_sends
     where status = 'SENT' and claimed_at >= p_since
     order by claimed_at desc
     limit 10
  ) as recent;
$$;
revoke execute on function ch20_list_recent_confirmed_sends(timestamptz) from public, anon, authenticated;
grant execute on function ch20_list_recent_confirmed_sends(timestamptz) to service_role;
