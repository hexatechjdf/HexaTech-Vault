-- =============================================================================
-- 0001_schema.sql — HexaTech Vault canonical schema
-- Source of truth: IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md §5
-- and 01_GOOGLE_DRIVE_CONNECTION_SUPER_ADMIN.md (immutability trigger).
--
-- Notes / deviations from Foundation §5 (all explicitly requested):
--   * The rotating Google ACCESS token is stored in a SEPARATE `drive_tokens`
--     table (not on `drive_connection`) so the locked singleton connection row
--     is NEVER mutated on token refresh (Foundation §4 / item 01 recommendation).
--   * A `sync_state` singleton table holds the Drive Changes API page token
--     (item 02 incremental sync).
--   * `drive_connection.access_token` / `token_expiry` columns from §5 are kept
--     for schema fidelity but are intentionally UNUSED (see drive_tokens).
-- =============================================================================

-- gen_random_uuid() lives in pgcrypto on older PG; on Supabase it is built-in,
-- but we ensure the extension is present for portability.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Departments
-- ---------------------------------------------------------------------------
create table departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                 -- 'Development', 'Sales', 'Projects', ...
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- App users (linked to Supabase auth.users)
-- ---------------------------------------------------------------------------
create type user_role as enum ('super_admin','admin','manager','team_lead','lead_dev','crm_expert');

create table app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role user_role not null,
  department_id uuid references departments(id),
  avatar text,
  status text not null default 'active',     -- 'active' | 'inactive'
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- The ONE company Drive connection (singleton — item 01)
-- The boolean-PK trick (id can only ever be true) forces exactly one row.
-- This row holds the ENCRYPTED refresh token and is LOCKED after first connect.
-- The access_token/token_expiry columns are retained for §5 fidelity but are
-- NOT used at runtime — rotation happens in drive_tokens to keep this row immutable.
-- ---------------------------------------------------------------------------
create table drive_connection (
  id boolean primary key default true check (id),   -- forces a single row
  connected_by uuid references app_users(id),
  google_account_email text,
  root_folder_id text,                              -- Drive fileId of the company root folder
  root_folder_name text,
  refresh_token_encrypted text,                     -- AES-256-GCM (see _shared/crypto.ts)
  access_token text,                                -- DEPRECATED — use drive_tokens instead
  token_expiry timestamptz,                         -- DEPRECATED — use drive_tokens instead
  status text not null default 'connected',         -- 'connected'
  locked boolean not null default true,             -- once connected, cannot change/remove
  connected_at timestamptz default now()
);

-- Rotating access token lives here so the locked drive_connection row never mutates.
create table drive_tokens (
  id boolean primary key default true check (id),   -- singleton, mirrors the connection
  access_token text,
  token_expiry timestamptz,
  refresh_token_encrypted text,                     -- mirror copy (optional fallback); source of truth is drive_connection
  updated_at timestamptz default now()
);

-- Drive Changes API incremental cursor (item 02). Singleton.
create table sync_state (
  id boolean primary key default true check (id),
  start_page_token text,
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Folder tree mirrored under the company root
-- ---------------------------------------------------------------------------
create table folders (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text unique not null,
  name text not null,
  parent_id uuid references folders(id) on delete cascade,   -- null only for the synced root
  is_root boolean not null default false,
  owner_department_id uuid references departments(id),       -- owning dept (item 06)
  created_by uuid references app_users(id),
  path text,                            -- materialized path, e.g. '/HexaTech Vault/Development/projX'
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- File metadata cache (bytes live in Drive)
create table files (
  id uuid primary key default gen_random_uuid(),
  drive_file_id text unique not null,
  name text not null,
  mime_type text,
  size_bytes bigint,
  folder_id uuid references folders(id) on delete cascade,
  uploaded_by uuid references app_users(id),
  web_view_link text,
  created_at timestamptz default now(),
  modified_at timestamptz,
  deleted_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Permission levels (capability matrix lives in Foundation §6 + permissions.ts)
-- ---------------------------------------------------------------------------
create type perm_level as enum (
  'no_access','view','view_download','view_upload','contributor','full_control'
);

-- Folder-based ACL — the system of record for who-can-do-what
create table permission_grants (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references folders(id) on delete cascade,
  principal_type text not null,         -- 'user' | 'department' | 'role'
  principal_id text not null,           -- app_users.id | departments.id | role name
  level perm_level not null default 'no_access',
  granted_by uuid references app_users(id),
  expires_at timestamptz,               -- optional time-boxed access
  created_at timestamptz default now(),
  unique (folder_id, principal_type, principal_id)
);

-- Cross-department assignees ("Shared with me" — item 06)
create table folder_assignees (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid references folders(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade,
  assigned_by uuid references app_users(id),
  created_at timestamptz default now(),
  unique (folder_id, user_id)
);

-- Audit trail (every privileged action)
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app_users(id),
  action text not null,                 -- 'drive.connect','folder.create','perm.grant','file.download', ...
  resource_type text,                   -- 'folder' | 'file' | 'connection' | 'permission'
  resource_id text,
  details jsonb,
  result text not null default 'success',  -- 'success' | 'failure'
  ip_address text,
  created_at timestamptz default now()
);

-- Sync run history (item 02)
create table sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz default now(),
  finished_at timestamptz,
  status text not null default 'running',  -- 'running' | 'success' | 'error'
  added int default 0,
  updated int default 0,
  removed int default 0,
  error text
);

-- ---------------------------------------------------------------------------
-- Immutability: the connection is permanent once locked (item 01).
-- Blocks ALL UPDATE/DELETE on the locked row. Token rotation is done in
-- drive_tokens, so this trigger never needs a bypass path.
-- ---------------------------------------------------------------------------
create or replace function prevent_connection_change() returns trigger as $$
begin
  if (TG_OP = 'DELETE') then
    raise exception 'Drive connection is permanent and cannot be removed';
  end if;
  if (OLD.locked = true) then
    raise exception 'Drive connection is locked and cannot be changed';
  end if;
  return NEW;
end; $$ language plpgsql;

create trigger trg_drive_connection_lock
before update or delete on drive_connection
for each row execute function prevent_connection_change();

-- ---------------------------------------------------------------------------
-- Indexes (requested) for fast subtree / ACL lookups
-- ---------------------------------------------------------------------------
create index idx_folders_parent_id        on folders(parent_id);
create index idx_folders_path             on folders(path);
create index idx_permission_grants_folder on permission_grants(folder_id);
create index idx_folder_assignees_folder_user on folder_assignees(folder_id, user_id);
create index idx_files_folder_id          on files(folder_id);

-- Helpful supporting indexes (not strictly required, cheap, used by the engine)
create index idx_folder_assignees_user    on folder_assignees(user_id);
create index idx_permission_grants_principal on permission_grants(principal_type, principal_id);
create index idx_files_drive_file_id      on files(drive_file_id);
create index idx_folders_drive_file_id    on folders(drive_file_id);
