create extension if not exists pg_cron;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'chapter12-delete-expired-fsc-snapshots'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'chapter12-delete-expired-fsc-snapshots',
    '17 18 * * *',
    $command$delete from public.chapter12_fsc_snapshots where fresh_until <= now()$command$
  );
end
$$;
