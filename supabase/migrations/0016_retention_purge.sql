-- =============================================================================
-- 0016_retention_purge.sql
-- Adds a nightly retention job that hard-deletes folders / files which have
-- been soft-deleted (deleted_at IS NOT NULL) for longer than the configured
-- retention window. Cleans up the long-term tombstone rows so the tables do
-- not grow forever, while still keeping a recovery window after a delete.
--
-- Defaults: retention_days = 7, runs daily at 02:00 UTC.
--
-- Change either at any time via SQL Editor:
--   update cron_config set retention_days = 14 where id = true;
--   select cron.alter_job(
--     (select jobid from cron.job where jobname = 'retention-purge-daily'),
--     schedule := '0 3 * * *'
--   );
--
-- IMPORTANT EFFECT:
--   After this migration runs, deleted folders / files older than 7 days are
--   permanently removed. Per-table FK cascades (defined in 0001_schema.sql,
--   on delete cascade) clean up dependent rows automatically:
--     - permission_grants pointing at the purged folder    -> cascade-delete
--     - folder_assignees   pointing at the purged folder    -> cascade-delete
--     - child folders / files                               -> cascade-delete
--   audit_log.resource_id is plain text (no FK) so audit rows survive with
--   the UUID string as a dangling reference - by design (audit_log outlives
--   the resource it describes).
-- =============================================================================

create extension if not exists pg_cron;

-- 1) Configurable retention window. Lives on the same singleton row that
--    holds cron URLs + secret. Default 7 days as agreed.
alter table cron_config
  add column if not exists retention_days integer not null default 7;

-- 2) The purge function itself. SECURITY DEFINER so pg_cron's role (which
--    is not the table owner) can still run the DELETEs. search_path is
--    pinned to public for safety.
create or replace function purge_soft_deleted()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days      integer;
  v_cutoff    timestamptz;
  v_files     integer := 0;
  v_folders   integer := 0;
begin
  select retention_days into v_days
  from cron_config where id = true;

  -- Defensive: if config not set, do nothing rather than nuke everything.
  if v_days is null or v_days < 1 then
    raise notice 'purge_soft_deleted skipped: cron_config.retention_days not configured';
    return;
  end if;

  v_cutoff := now() - (v_days || ' days')::interval;

  -- Delete leaf-level files first. (Folder cascades would also catch files
  -- under purged folders, but doing files first means we also catch old
  -- soft-deleted files whose parent folder is still alive.)
  with deleted as (
    delete from files
    where deleted_at is not null and deleted_at < v_cutoff
    returning 1
  )
  select count(*) into v_files from deleted;

  -- Then folders. Hard skip is_root = true (defense in depth on top of the
  -- existing 0008 trigger that prevents soft-deleting the root).
  with deleted as (
    delete from folders
    where deleted_at is not null
      and deleted_at < v_cutoff
      and is_root = false
    returning 1
  )
  select count(*) into v_folders from deleted;

  -- Record one audit row per run so operators can audit the purge history
  -- without dumping cron.job_run_details.
  insert into audit_log (actor_id, action, resource_type, resource_id, details, result)
  values (
    null,
    'system.retention_purge',
    'system',
    null,
    jsonb_build_object(
      'retention_days',  v_days,
      'cutoff',          v_cutoff,
      'purged_files',    v_files,
      'purged_folders',  v_folders
    ),
    'success'
  );
end;
$$;

-- 3) Schedule: daily at 02:00 UTC. Idempotent unschedule first so re-runs
--    of this migration are safe.
do $$
begin
  perform cron.unschedule('retention-purge-daily')
  where exists (select 1 from cron.job where jobname = 'retention-purge-daily');
exception when others then
  null;
end $$;

select cron.schedule(
  'retention-purge-daily',
  '0 2 * * *',
  $cron$ select public.purge_soft_deleted(); $cron$
);

-- Verify:
--   select jobname, schedule, active from cron.job where jobname = 'retention-purge-daily';
--   select * from audit_log where action = 'system.retention_purge' order by created_at desc limit 5;
