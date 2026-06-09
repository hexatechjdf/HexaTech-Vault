-- =============================================================================
-- 0020_cron_backup.sql — Daily trigger for the backup-run Edge Function.
--
-- Adds backup_url to cron_config, defines trigger_backup() (the SECURITY
-- DEFINER wrapper pg_cron calls), and schedules it daily at 03:00 UTC.
--
-- One schedule, three frequencies: the cron fires every day, but the Edge
-- Function consults backup_config.frequency before doing work. weekly skips
-- non-Sundays; monthly skips non-day-1. This avoids juggling three named
-- cron jobs (and reschedules) when the UI changes the frequency setting.
--
-- After this migration runs, set the URL once (same pattern as drive sync):
--
--   update cron_config set
--     backup_url = 'https://<project-ref>.functions.supabase.co/backup-run'
--   where id = true;
--
-- The cron_secret column (added in 0013) is reused as-is.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Extend cron_config so the backup trigger has somewhere to read its URL.
alter table cron_config
  add column if not exists backup_url text;

-- 2) Wrapper function pg_cron calls. Mirrors trigger_drive_sync().
create or replace function trigger_backup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text;
  v_secret text;
begin
  select backup_url, cron_secret into v_url, v_secret
  from cron_config where id = true;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    raise notice 'trigger_backup skipped: cron_config.backup_url / cron_secret not configured';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer ' || v_secret
               ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
end;
$$;

-- 3) Schedule: daily at 03:00 UTC. Idempotent — unschedule any prior job of
--    the same name first so re-running this migration is safe.
do $$
begin
  perform cron.unschedule('daily-backup')
  where exists (select 1 from cron.job where jobname = 'daily-backup');
exception when others then
  -- ignore if the job did not exist
  null;
end $$;

select cron.schedule(
  'daily-backup',
  '0 3 * * *',
  $cron$ select public.trigger_backup(); $cron$
);

-- Verify with:  select * from cron.job where jobname = 'daily-backup';
-- Inspect runs: select * from cron.job_run_details order by start_time desc limit 20;
