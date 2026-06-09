-- =============================================================================
-- 0013_cron_config_table.sql
-- Replaces the GUC (`alter database ... set app.X`) configuration used in
-- 0003_cron.sql and 0012_cron_drive_refresh.sql with a small singleton table.
--
-- Why: Supabase's SQL Editor runs as a role that lacks privilege to
-- `alter database postgres set app.X` (ERROR 42501). The GUC approach therefore
-- silently no-ops the cron jobs unless you connect as the underlying postgres
-- superuser via psql. Storing the same config in an RLS-locked table is
-- equivalent in safety - no client can read it - but is settable with a
-- normal UPDATE in the SQL Editor.
--
-- After this migration runs, configure with one statement (replace the
-- secret + URLs to match your project ref + supabase secrets set CRON_SECRET=...):
--
--   update cron_config set
--     drive_sync_url    = 'https://<project-ref>.functions.supabase.co/sync-drive',
--     drive_refresh_url = 'https://<project-ref>.functions.supabase.co/drive-refresh-token',
--     cron_secret       = '<the CRON_SECRET you set in supabase secrets>'
--   where id = true;
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Singleton config row. Mirrors the drive_connection pattern (id boolean PK).
create table if not exists cron_config (
  id boolean primary key default true check (id),
  drive_sync_url text,
  drive_refresh_url text,
  cron_secret text,
  updated_at timestamptz default now()
);

-- Lock it down. RLS on, no policies = no client (anon/authenticated) can read
-- or write. The trigger_* functions below are SECURITY DEFINER and run as the
-- function owner (postgres), which bypasses RLS — so they can still read it.
-- Updates from the SQL Editor run as the postgres role, which is the table
-- owner, which bypasses RLS for writes.
alter table cron_config enable row level security;

-- Seed the row so configuration is an UPDATE (no NULL-handling on insert path).
insert into cron_config (id) values (true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Replace the GUC-based trigger functions with table-based ones. Bodies are
-- functionally identical to 0003 / 0012 except for the source of url + secret.
-- ---------------------------------------------------------------------------

create or replace function trigger_drive_sync()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select drive_sync_url, cron_secret into v_url, v_secret
  from cron_config where id = true;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    raise notice 'trigger_drive_sync skipped: cron_config.drive_sync_url / cron_secret not configured';
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

create or replace function trigger_drive_token_refresh()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
begin
  select drive_refresh_url, cron_secret into v_url, v_secret
  from cron_config where id = true;

  if v_url is null or v_url = '' or v_secret is null or v_secret = '' then
    raise notice 'trigger_drive_token_refresh skipped: cron_config.drive_refresh_url / cron_secret not configured';
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
