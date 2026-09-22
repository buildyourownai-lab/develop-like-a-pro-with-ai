-- Remove only the application send caps. Existing counts remain historical statistics.
-- Same comment id uniqueness and exclusive send gate remain enforced.
create or replace function ch20_claim_send(
  p_top_level_comment_id text,
  p_video_id text,
  p_send_day date,
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
revoke all on function ch20_claim_send(text, text, date, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function ch20_claim_send(text, text, date, timestamptz, timestamptz, text) to service_role;

-- The former ten-row bound depended on the removed five-per-day cap.
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
  ) as recent;
$$;
revoke execute on function ch20_list_recent_confirmed_sends(timestamptz) from public, anon, authenticated;
grant execute on function ch20_list_recent_confirmed_sends(timestamptz) to service_role;

-- Preserve the previous caller signature during deployment/rollback. The old
-- argument is accepted for compatibility and no longer imposes a send cap.
create or replace function ch20_claim_send(
  p_top_level_comment_id text, p_video_id text, p_send_day date,
  p_daily_limit integer, p_claimed_at timestamptz,
  p_lock_expires_at timestamptz, p_reason text
) returns jsonb language sql security definer set search_path = public as $$
  select ch20_claim_send(p_top_level_comment_id, p_video_id, p_send_day,
    p_claimed_at, p_lock_expires_at, p_reason);
$$;
revoke all on function ch20_claim_send(text, text, date, integer, timestamptz, timestamptz, text) from public, anon, authenticated;
grant execute on function ch20_claim_send(text, text, date, integer, timestamptz, timestamptz, text) to service_role;
