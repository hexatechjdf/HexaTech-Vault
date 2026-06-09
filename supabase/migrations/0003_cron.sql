-- =============================================================================
-- 0003_cron.sql — hourly Drive metadata sync (item 02)
-- Schedules an hourly POST to the `sync-drive` Edge Function via pg_net.
-- The function URL and the CRON_SECRET are read from database GUC settings so
-- no secret is hard-coded in the migration.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- REQUIRED ONE-TIME CONFIG (run these as a privileged user before the cron can
-- work; values are NOT committed to the repo). Replace <project-ref> and the
-- secret to match `supabase secrets set CRON_SECRET=...`.
--
--   alter database postgres set app.sync_url   = 'https://<project-ref>.functions.supabase.co/sync-drive';
--   alter database postgres set app.cron_secret = '<the CRON_SECRET you set in supabase secrets>';
--
-- After running the ALTER DATABASE statements, reconnect (or `select pg_reload_conf();`)
-- so current_setting() picks them up, then (re)create the schedule below.
--
-- Alternatively store them in Supabase Vault and read via vault.decrypted_secrets;
-- the GUC approach above is the simplest and is what this job uses.
-- ---------------------------------------------------------------------------

-- Wrapper DB function the cron calls. Reads the URL + secret from GUC at runtime
-- so rotating the secret only requires re-running the ALTER DATABASE above.
create or replace function trigger_drive_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url    text := current_setting('app.sync_url', true);
  v_secret text := current_setting('app.cron_secret', true);
begin
  if v_url is null or v_secret is null then
    raise notice 'trigger_drive_sync skipped: app.sync_url / app.cron_secret not configured';
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

-- ---------------------------------------------------------------------------
-- Schedule: every hour on the hour. Idempotent — unschedule any prior job of
-- the same name first so re-running this migration is safe.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('hourly-drive-sync')
  where exists (select 1 from cron.job where jobname = 'hourly-drive-sync');
exception when others then
  -- ignore if the job did not exist
  null;
end $$;

select cron.schedule(
  'hourly-drive-sync',
  '0 * * * *',
  $cron$ select public.trigger_drive_sync(); $cron$
);

-- Verify with:  select * from cron.job;
-- Inspect runs: select * from cron.job_run_details order by start_time desc limit 20;
