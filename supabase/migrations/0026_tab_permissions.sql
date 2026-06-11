-- =============================================================================
-- 0026_tab_permissions.sql
--
-- Brand-new permission system for the application's UI surfaces ("tabs"),
-- separate from folder permissions. Folder permissions govern data inside
-- the Drive; tab permissions govern who can use which screen of the app and
-- whether they can perform actions on it.
--
-- Model (mirrors the folder engine, but FLAT — no ancestor walking):
--
--   At each lookup:
--     1. Personal user grant for the caller          -> use it (incl. no_access)
--     2. Role+dept grant matching my role AND my dept -> use it (MORE SPECIFIC)
--     3. Role-only grant matching my role             -> use it
--     If no grant matches                             -> 'no_access' (default)
--
-- Super Admin short-circuits to 'action' on every tab.
--
-- Three levels:
--   no_access   tab hidden from nav, URL redirects to /dashboard
--   view        tab visible, data loads, action buttons disabled
--   action      tab visible, data loads, full ability to mutate
--
-- See .claude/rules/permissions.md "Tab Permission System" section for the
-- full spec and worked examples this migration implements.
-- =============================================================================

-- ─── 1) Enums ────────────────────────────────────────────────────────────────
-- Tab registry. Adding a new tab = adding a value here AND in lib/tabs.ts.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tab_name') then
    create type tab_name as enum (
      'user_management',
      'folder_access',
      'file_manager',
      'audit_logs',
      'storage_overview',
      'settings'
    );
  end if;
end $$;

-- Effective levels. Ordering of values is intentional (lowest first) so any
-- future "max" calls have a defined ordering, even though the engine never
-- combines via max — it returns the first match per precedence rule.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'tab_level') then
    create type tab_level as enum (
      'no_access',
      'view',
      'action'
    );
  end if;
end $$;

-- ─── 2) Grants table ─────────────────────────────────────────────────────────
create table if not exists tab_permission_grants (
  id                 uuid primary key default gen_random_uuid(),
  tab                tab_name not null,
  principal_type     text not null check (principal_type in ('user', 'role')),
  -- For 'user' principal_id is the user's UUID stored as text.
  -- For 'role' principal_id is the role enum value as text (eg 'team_lead').
  principal_id       text not null,
  -- NULL = unscoped role grant (applies to everyone with this role across all
  -- departments). A real dept uuid scopes the grant to that department.
  -- ENFORCED NULL for user-type grants by the check constraint below.
  principal_dept_id  uuid references departments(id) on delete cascade,
  level              tab_level not null,
  granted_by         uuid references app_users(id),
  granted_at         timestamptz not null default now(),
  -- A user grant is per-individual, so a department scope is meaningless.
  constraint tab_grants_user_dept_check
    check (principal_type <> 'user' or principal_dept_id is null)
);

-- Same (tab, type, id, coalesce(dept, sentinel)) uniqueness pattern as folder
-- grants, so the dept-null and dept-set variants of "role=X on tab Y" are
-- distinct rows and either can be upserted without colliding with the other.
create unique index if not exists tab_permission_grants_unique_principal
  on tab_permission_grants (
    tab,
    principal_type,
    principal_id,
    coalesce(principal_dept_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Fast lookup for the engine's role+dept path.
create index if not exists idx_tab_grants_role_dept
  on tab_permission_grants (tab, principal_type, principal_id, principal_dept_id)
  where principal_type = 'role';

-- ─── 3) RLS ──────────────────────────────────────────────────────────────────
alter table tab_permission_grants enable row level security;

-- Only super admins can directly read/write this table. Non-super users
-- query their own effective levels through get_effective_tab_level() /
-- get_my_tab_access(), which are SECURITY DEFINER and bypass RLS.
drop policy if exists "Super admin can manage tab grants" on tab_permission_grants;
create policy "Super admin can manage tab grants"
  on tab_permission_grants
  for all
  to authenticated
  using (
    exists (
      select 1 from app_users
      where id = auth.uid()
        and role = 'super_admin'
        and status = 'active'
    )
  )
  with check (
    exists (
      select 1 from app_users
      where id = auth.uid()
        and role = 'super_admin'
        and status = 'active'
    )
  );

-- ─── 4) Engine: single-tab lookup ────────────────────────────────────────────
-- Returns the caller's effective level on a specific tab, following the
-- user-wins -> role+dept -> role-unscoped precedence documented in the rules.
create or replace function get_effective_tab_level(p_user uuid, p_tab tab_name)
returns tab_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role        text;
  v_dept        uuid;
  v_user_level  tab_level;
  v_role_level  tab_level;
begin
  if p_user is null or p_tab is null then
    return 'no_access';
  end if;

  -- Super Admin short-circuit: 'action' on every tab.
  if is_super_admin(p_user) then
    return 'action';
  end if;

  select role::text, department_id into v_role, v_dept
  from app_users
  where id = p_user;

  -- 1. Personal user grant wins over everything else (incl. explicit no_access).
  select level into v_user_level
  from tab_permission_grants
  where tab = p_tab
    and principal_type = 'user'
    and principal_id = p_user::text
  limit 1;

  if v_user_level is not null then
    return v_user_level;
  end if;

  -- 2. Role grant scoped to the caller's department (more specific).
  if v_dept is not null then
    select level into v_role_level
    from tab_permission_grants
    where tab = p_tab
      and principal_type = 'role'
      and principal_id = v_role
      and principal_dept_id = v_dept
    limit 1;

    if v_role_level is not null then
      return v_role_level;
    end if;
  end if;

  -- 3. Unscoped role grant (applies to everyone with this role).
  select level into v_role_level
  from tab_permission_grants
  where tab = p_tab
    and principal_type = 'role'
    and principal_id = v_role
    and principal_dept_id is null
  limit 1;

  if v_role_level is not null then
    return v_role_level;
  end if;

  return 'no_access';
end;
$$;

-- ─── 5) Convenience: every tab's level for a user ────────────────────────────
-- One round-trip lookup that returns all 6 tabs with their effective level
-- for the caller. The frontend calls this once at session start to render
-- the nav + cache per-tab gating.
create or replace function get_my_tab_access(p_user uuid)
returns table(tab tab_name, level tab_level)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  t tab_name;
begin
  for t in
    select unnest(enum_range(null::tab_name))
  loop
    tab := t;
    level := get_effective_tab_level(p_user, t);
    return next;
  end loop;
end;
$$;

-- ─── 6) Grant EXECUTE so the engine is reachable via RPC ─────────────────────
-- These functions are SECURITY DEFINER so they always run with the function
-- owner's permissions (postgres bypassrls). Granting EXECUTE to authenticated
-- lets any signed-in user ask "what's MY level on tab X" without exposing the
-- underlying grants table.
grant execute on function get_effective_tab_level(uuid, tab_name) to authenticated;
grant execute on function get_my_tab_access(uuid) to authenticated;

-- Verify with:
--   select * from get_my_tab_access('<some_user_uuid>');
-- Should return 6 rows (one per tab) with that user's effective level.
