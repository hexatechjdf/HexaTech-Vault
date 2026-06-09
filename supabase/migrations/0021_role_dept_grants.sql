-- =============================================================================
-- 0021_role_dept_grants.sql — Department-scoped role grants.
--
-- Adds `principal_dept_id` to `permission_grants` so a role grant can be
-- optionally scoped to a single department.
--
--   principal_type='user'  : principal_dept_id MUST be NULL (irrelevant).
--   principal_type='role'  : principal_dept_id may be NULL (all departments,
--                            i.e. the prior behaviour) or a real department
--                            UUID (only users with the same role *and* that
--                            department get the grant).
--
-- Resolution precedence (extended user-wins, applied at each ancestor folder
-- walking nearest-first toward the root):
--
--   1. Personal user grant for the caller          -> use it (incl. no_access)
--   2. Role+dept grant matching my role AND my dept -> use it (MORE SPECIFIC)
--   3. Role-only grant matching my role             -> use it
--   4. Climb to parent.
--   If no ancestor has any applicable grant         -> 'no_access'.
--
-- Step 2 is the new tier. Step 3 keeps every existing role grant working
-- unchanged (those rows have principal_dept_id = NULL).
-- =============================================================================

-- ─── 1) New column ───────────────────────────────────────────────────────────
alter table permission_grants
  add column if not exists principal_dept_id uuid references departments(id) on delete cascade;

-- A user grant is per-individual, so a department scope is meaningless.
-- A role grant may be NULL (all departments) or a specific department.
alter table permission_grants
  drop constraint if exists permission_grants_user_dept_check;

alter table permission_grants
  add constraint permission_grants_user_dept_check
  check (principal_type <> 'user' or principal_dept_id is null);

-- ─── 2) Unique key — replace the (folder, type, id) constraint with one that
--      also includes principal_dept_id. Partial-index trick lets NULL be
--      treated as a distinct slot (Postgres treats NULL as not-equal in UNIQUE
--      constraints by default, so two NULLs would already not collide, but
--      we use COALESCE to be explicit and consistent). ────────────────────────

-- Drop the old unique constraint if it exists. The original schema used
-- (folder_id, principal_type, principal_id) — pick up whichever name Postgres
-- gave it on either path.
do $$
declare
  v_name text;
begin
  select conname into v_name
  from pg_constraint
  where conrelid = 'permission_grants'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) ilike '%(folder_id, principal_type, principal_id)%'
  limit 1;
  if v_name is not null then
    execute format('alter table permission_grants drop constraint %I', v_name);
  end if;
end $$;

-- Drop any prior version of this index (re-run safety).
drop index if exists permission_grants_unique_principal;

-- New unique index. COALESCE swaps NULL -> sentinel UUID so the dept-null and
-- dept-set variants of "role=team_member on folder X" are distinct rows.
create unique index permission_grants_unique_principal
  on permission_grants (
    folder_id,
    principal_type,
    principal_id,
    coalesce(principal_dept_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- Index on the new column for the engine's nearest-ancestor lookup.
create index if not exists idx_permission_grants_role_dept
  on permission_grants (folder_id, principal_type, principal_id, principal_dept_id)
  where principal_type = 'role';

-- ─── 3) Rewrite get_effective_level() with the new precedence ────────────────
create or replace function get_effective_level(p_user uuid, p_folder uuid)
returns perm_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role        text;
  v_dept        uuid;
  v_cursor      uuid := p_folder;
  v_user_level  perm_level;
  v_role_level  perm_level;
begin
  if p_user is null or p_folder is null then
    return 'no_access';
  end if;

  -- Super Admin short-circuit: full_control everywhere.
  if is_super_admin(p_user) then
    return 'full_control';
  end if;

  select role::text, department_id into v_role, v_dept
  from app_users
  where id = p_user;

  -- Walk folder -> root.
  while v_cursor is not null loop
    -- 1. Personal user grant takes precedence over everything else at this
    --    ancestor, including 'no_access' (explicit revocation).
    select level into v_user_level
    from permission_grants
    where folder_id = v_cursor
      and principal_type = 'user'
      and principal_id = p_user::text
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_user_level is not null then
      return v_user_level;
    end if;

    -- 2. NEW: role grant scoped to the caller's department (more specific than
    --    an unscoped role grant — wins over step 3 at the same ancestor).
    if v_dept is not null then
      select level into v_role_level
      from permission_grants
      where folder_id = v_cursor
        and principal_type = 'role'
        and principal_id = v_role
        and principal_dept_id = v_dept
        and (expires_at is null or expires_at > now())
      limit 1;

      if v_role_level is not null then
        return v_role_level;
      end if;
    end if;

    -- 3. Unscoped role grant (principal_dept_id is null) — kept so existing
    --    grants continue to work for "everyone with this role".
    select level into v_role_level
    from permission_grants
    where folder_id = v_cursor
      and principal_type = 'role'
      and principal_id = v_role
      and principal_dept_id is null
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_role_level is not null then
      return v_role_level;
    end if;

    -- 4. Climb to parent.
    select parent_id into v_cursor from folders where id = v_cursor;
  end loop;

  -- No ancestor had any applicable grant.
  return 'no_access';
end;
$$;

-- Verify with:
--   select get_effective_level('<user_uuid>', '<folder_uuid>');
