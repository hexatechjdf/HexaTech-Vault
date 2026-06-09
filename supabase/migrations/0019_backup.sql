-- =============================================================================
-- 0019_backup.sql — Backup engine schema (singleton config + run history).
--
-- Adds two tables and a private Storage bucket so the app can periodically
-- snapshot its irreplaceable Postgres state (users, departments, folders,
-- files, permissions, branding) to a JSON archive. Drive bytes are NOT
-- re-archived (Drive is already the source of truth for them); the audit_log
-- table is explicitly excluded too — see backup-run/index.ts.
--
-- Singleton pattern (id boolean PK default true check (id)) matches the
-- branding / drive_connection / cron_config tables.
-- =============================================================================

-- ─── 1) backup_config (singleton) ────────────────────────────────────────────
create table if not exists backup_config (
  id              boolean primary key default true check (id),
  enabled         boolean not null default true,
  frequency       text    not null default 'daily'
                  check (frequency in ('daily', 'weekly', 'monthly')),
  retention_days  int     not null default 30 check (retention_days >= 1),
  -- Storage bucket where archives are written. Kept configurable so an
  -- off-platform bucket (S3, R2) could be wired in later without touching
  -- the schema. Default = the bucket created at the bottom of this file.
  bucket          text    not null default 'backups',
  updated_at      timestamptz default now(),
  updated_by      uuid references app_users(id)
);

-- Seed the singleton row so GET /api/admin/backup/config always returns
-- a real row on a fresh database.
insert into backup_config (id) values (true) on conflict (id) do nothing;

-- ─── 2) backup_runs (history) ────────────────────────────────────────────────
create table if not exists backup_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running'
                check (status in ('running', 'success', 'failed')),
  -- Total bytes uploaded to storage. Null while running / on early failure.
  bytes         bigint,
  -- Object key inside the bucket (e.g. 2026/06/09/backup-<uuid>.json.gz).
  -- Null while running; populated on success.
  object_path   text,
  -- First 500 chars of the failure message (if any).
  error         text,
  -- Whether the run was kicked off by the scheduler or a manual UI action.
  triggered_by  text not null default 'cron'
                check (triggered_by in ('cron', 'manual')),
  -- The super_admin who clicked "Run Manual Backup Now" (null for cron).
  actor_id      uuid references app_users(id)
);

create index if not exists idx_backup_runs_started on backup_runs(started_at desc);
create index if not exists idx_backup_runs_status  on backup_runs(status);

-- ─── 3) RLS — super_admin only ───────────────────────────────────────────────
alter table backup_config enable row level security;
alter table backup_runs   enable row level security;

create policy "Super admin reads backup_config"
  on backup_config for select
  to authenticated
  using (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'super_admin' and status = 'active'
    )
  );

create policy "Super admin updates backup_config"
  on backup_config for update
  to authenticated
  using (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'super_admin' and status = 'active'
    )
  );

create policy "Super admin reads backup_runs"
  on backup_runs for select
  to authenticated
  using (
    exists (
      select 1 from app_users
      where id = auth.uid() and role = 'super_admin' and status = 'active'
    )
  );

-- backup_runs writes happen only via the service-role client inside the
-- backup-run Edge Function, which bypasses RLS. No insert/update policies.

-- ─── 4) Private Storage bucket ───────────────────────────────────────────────
-- Archives are JSON+gzip text blobs. Not user-facing, so the bucket is private:
-- the BFF mints a short-lived signed URL when a super_admin clicks Download.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'backups',
  'backups',
  false,
  104857600,                 -- 100 MB ceiling per archive (well above expected)
  array['application/gzip', 'application/json']
)
on conflict (id) do nothing;
