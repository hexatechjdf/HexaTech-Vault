-- =============================================================================
-- 0002_rls_and_functions.sql — RLS + the permission resolution engine
-- Implements Foundation §6 resolution order in SQL so it is usable both from
-- RLS policies and from Edge Functions (via RPC get_effective_level).
--
-- Resolution order (highest wins), ignoring expired grants:
--   1. super_admin                         -> always full_control
--   2. direct USER grant on the folder
--   3. nearest ANCESTOR folder grant (user, then dept, then role at that level)
--   4. DEPARTMENT grant (user's department) on the folder
--   5. ROLE grant (user's role) on the folder
--   6. otherwise no_access
--
-- The implementation walks the folder -> root ancestor chain. At each level it
-- prefers a more specific principal (user > department > role). The first level
-- (nearest to the target folder, starting at the folder itself) that yields any
-- non-expired grant wins — a more specific child grant overrides an ancestor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- is_super_admin(uuid) — helper used by the engine and by RLS policies.
-- SECURITY DEFINER so RLS policies can call it without recursive policy checks.
-- ---------------------------------------------------------------------------
create or replace function is_super_admin(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from app_users
    where id = p_user and role = 'super_admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- perm_rank(perm_level) — numeric ordering so we can take MAX() across the
-- principal types at a given ancestor level.
-- ---------------------------------------------------------------------------
create or replace function perm_rank(p perm_level)
returns int
language sql
immutable
as $$
  select case p
    when 'no_access'     then 0
    when 'view'          then 1
    when 'view_download' then 2
    when 'view_upload'   then 3
    when 'contributor'   then 4
    when 'full_control'  then 5
  end;
$$;

create or replace function perm_from_rank(r int)
returns perm_level
language sql
immutable
as $$
  select case r
    when 0 then 'no_access'::perm_level
    when 1 then 'view'::perm_level
    when 2 then 'view_download'::perm_level
    when 3 then 'view_upload'::perm_level
    when 4 then 'contributor'::perm_level
    when 5 then 'full_control'::perm_level
    else 'no_access'::perm_level
  end;
$$;

-- ---------------------------------------------------------------------------
-- get_effective_level(p_user, p_folder) -> perm_level
-- Core engine. SECURITY DEFINER so RLS policies can call it freely.
-- ---------------------------------------------------------------------------
create or replace function get_effective_level(p_user uuid, p_folder uuid)
returns perm_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dept     uuid;
  v_role     text;
  v_cursor   uuid := p_folder;
  v_best     int;
begin
  if p_user is null or p_folder is null then
    return 'no_access';
  end if;

  -- 1. super_admin short-circuit
  if is_super_admin(p_user) then
    return 'full_control';
  end if;

  select department_id, role::text into v_dept, v_role
  from app_users where id = p_user;

  -- 2..5: walk folder -> root. The nearest level (starting at the folder
  -- itself) that produces any grant wins, so a specific child grant overrides
  -- an inherited ancestor grant. Within a level, the highest of
  -- {user, department, role} grant applies.
  while v_cursor is not null loop
    select max(perm_rank(level)) into v_best
    from permission_grants
    where folder_id = v_cursor
      and (expires_at is null or expires_at > now())
      and (
            (principal_type = 'user'       and principal_id = p_user::text)
         or (principal_type = 'department' and v_dept is not null and principal_id = v_dept::text)
         or (principal_type = 'role'       and principal_id = v_role)
      );

    -- A grant of no_access (rank 0) at this level still "stops" inheritance:
    -- it is an explicit override meaning "no access here". We only continue up
    -- the tree when NO grant of any kind exists at this level.
    if v_best is not null then
      return perm_from_rank(v_best);
    end if;

    -- climb to parent
    select parent_id into v_cursor from folders where id = v_cursor;
  end loop;

  -- 6. default
  return 'no_access';
end;
$$;

-- Convenience: effective level by drive_file_id (used by some Edge paths).
create or replace function get_effective_level_by_drive_id(p_user uuid, p_drive_file_id text)
returns perm_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_folder uuid;
begin
  select id into v_folder from folders where drive_file_id = p_drive_file_id;
  if v_folder is null then
    return 'no_access';
  end if;
  return get_effective_level(p_user, v_folder);
end;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on EVERY table. Service-role connections (Edge Functions) bypass
-- RLS automatically, so these policies only constrain client (anon/authed) JWT
-- access. We deliberately add NO policies to the sensitive token tables, which
-- means authenticated users can read/write nothing there (deny-by-default).
-- ---------------------------------------------------------------------------
alter table departments       enable row level security;
alter table app_users         enable row level security;
alter table drive_connection  enable row level security;
alter table drive_tokens      enable row level security;
alter table sync_state        enable row level security;
alter table folders           enable row level security;
alter table files             enable row level security;
alter table permission_grants enable row level security;
alter table folder_assignees  enable row level security;
alter table audit_log         enable row level security;
alter table sync_runs         enable row level security;

-- Force RLS even for the table owner role used by migrations (defense in depth;
-- service_role still bypasses because it has BYPASSRLS).
alter table drive_connection  force row level security;
alter table drive_tokens      force row level security;

-- ---------------------------------------------------------------------------
-- Read-reference data: any authenticated user may read departments and the
-- public profile fields of app_users (needed to render principals/assignees).
-- ---------------------------------------------------------------------------
create policy departments_select_authenticated
  on departments for select
  to authenticated
  using (true);

create policy app_users_select_authenticated
  on app_users for select
  to authenticated
  using (true);

create policy app_users_update_self
  on app_users for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---------------------------------------------------------------------------
-- folders: a client may SELECT a folder only when their effective level is not
-- no_access, OR they belong to the owning department (so owner-dept members can
-- see their department's tree even before explicit grants). Mutations go
-- through Edge Functions (service role), so no client INSERT/UPDATE policies.
-- ---------------------------------------------------------------------------
create policy folders_select_effective
  on folders for select
  to authenticated
  using (
    get_effective_level(auth.uid(), id) <> 'no_access'
    or owner_department_id = (
         select department_id from app_users where id = auth.uid()
       )
  );

-- files: visible when the parent folder is visible (effective level on the
-- containing folder is not no_access, or owner-dept).
create policy files_select_effective
  on files for select
  to authenticated
  using (
    exists (
      select 1 from folders f
      where f.id = files.folder_id
        and (
          get_effective_level(auth.uid(), f.id) <> 'no_access'
          or f.owner_department_id = (
               select department_id from app_users where id = auth.uid()
             )
        )
    )
  );

-- ---------------------------------------------------------------------------
-- permission_grants / folder_assignees: a client may read grants for folders
-- where they have full_control (manage access) or are super_admin. Writes are
-- Edge-Function-only.
-- ---------------------------------------------------------------------------
create policy grants_select_managers
  on permission_grants for select
  to authenticated
  using (
    is_super_admin(auth.uid())
    or get_effective_level(auth.uid(), folder_id) = 'full_control'
  );

create policy assignees_select_visible
  on folder_assignees for select
  to authenticated
  using (
    is_super_admin(auth.uid())
    or user_id = auth.uid()
    or get_effective_level(auth.uid(), folder_id) = 'full_control'
  );

-- ---------------------------------------------------------------------------
-- audit_log: super_admin may read everything; an admin may read rows for actors
-- in their own department (mirrors the frontend AuditLogs department scoping).
-- ---------------------------------------------------------------------------
create policy audit_select_super_admin
  on audit_log for select
  to authenticated
  using (is_super_admin(auth.uid()));

create policy audit_select_admin_department
  on audit_log for select
  to authenticated
  using (
    exists (
      select 1
      from app_users me
      join app_users actor on actor.id = audit_log.actor_id
      where me.id = auth.uid()
        and me.role = 'admin'
        and actor.department_id = me.department_id
    )
  );

-- sync_runs: super_admin may read (for "Last synced" / sync history UI).
create policy sync_runs_select_super_admin
  on sync_runs for select
  to authenticated
  using (is_super_admin(auth.uid()));

-- NOTE on token tables (drive_connection, drive_tokens, sync_state): no SELECT
-- policy is created, so authenticated clients get zero rows. Connection STATUS
-- for the UI is exposed only through the `connection-status` Edge Function,
-- which returns non-secret fields. This guarantees no Google token can be read
-- by a browser even with a stolen authed JWT.
