-- =============================================================================
-- 0012_cron_drive_refresh.sql
-- Schedules a 5-minute POST to the drive-refresh-token Edge Function.
--
-- Why every 5 minutes: getAccessToken() refreshes only when the current token
-- is within 5 minutes of expiry. Running the cron every 5 minutes guarantees
-- that at most one tick passes between "still valid" and "expired", so the
-- token is replaced in plenty of time. The Edge Function itself is a no-op
-- when there's >5 minutes left, so most ticks cost nothing - the actual Google
-- refresh call happens roughly once per hour, at the 55-minute mark.
--
-- Uses the same GUC + pg_net pattern as 0003_cron.sql.
-- =============================================================================

-- pg_cron and pg_net are already enabled by 0003_cron.sql; safe to re-run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- REQUIRED ONE-TIME CONFIG (run once before the cron can fire). Replace
-- <project-ref> with your Supabase project ref. app.cron_secret is already
-- configured by 0003_cron.sql; re-use it.
--
--   alter database postgres set app.refresh_url = 'https://<project-ref>.functions.supabase.co/drive-refresh-token';
--   -- app.cron_secret should already be set from 0003_cron.sql; if not:
--   -- alter database postgres set app.cron_secret = '<the CRON_SECRET you set in supabase secrets>';
--
-- After running the ALTER DATABASE statement, reload config so current_setting
-- picks it up:
--   select pg_reload_conf();
-- ---------------------------------------------------------------------------

create or replace function trigger_drive_token_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text := current_setting('app.refresh_url', true);
  v_secret text := current_setting('app.cron_secret', true);
begin
  if v_url is null or v_secret is null then
    raise notice 'trigger_drive_token_refresh skipped: app.refresh_url / app.cron_secret not configured';
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

-- Idempotent (re)schedule.
do $$
begin
  perform cron.unschedule('drive-refresh-token-5min')
  where exists (select 1 from cron.job where jobname = 'drive-refresh-token-5min');
exception when others then
  null;
end $$;

select cron.schedule(
  'drive-refresh-token-5min',
  '*/5 * * * *',
  $cron$ select public.trigger_drive_token_refresh(); $cron$
);

-- Verify with:  select * from cron.job where jobname = 'drive-refresh-token-5min';
-- Recent runs:  select status, return_message, start_time, end_time
--               from cron.job_run_details
--               where jobid = (select jobid from cron.job where jobname = 'drive-refresh-token-5min')
--               order by start_time desc limit 20;
