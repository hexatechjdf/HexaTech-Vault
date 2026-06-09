-- 0018_user_wins_permission_engine.sql
--
-- Rewrites get_effective_level() with USER-WINS semantics:
--
--   At each ancestor (nearest-first walk):
--     1. If a personal user grant exists for the caller -> use that level,
--        even if the level is 'no_access' (explicit revocation).
--     2. Else if a role grant exists for the caller's role -> use that level.
--     3. Else climb to the parent.
--   If no ancestor has any applicable grant -> 'no_access'.
--
-- This replaces the previous MAX-WINS model where user/role grants at the same
-- ancestor were combined via max(). The new model lets a Super Admin:
--   - Promote an individual user above their role's baseline (user grant > role)
--   - Lock a specific user OUT of a role-granted folder (user grant 'no_access')
-- Both are essential for a "reliable and supportive" permission system, and
-- match the convention used by SharePoint / Box / Dropbox Business.
--
-- Department grants have already been removed from the data (migration 0015)
-- and from the codebase; the new function does not consider them at all.
--
-- Side notes:
--   - perm_rank / perm_from_rank are no longer used here (no max needed).
--     They remain in the schema for other callers but this function bypasses
--     them entirely.
--   - "Nearest grant wins" across ancestors is preserved. An explicit child
--     grant always overrides an inherited ancestor grant, regardless of type.
--   - File permissions still resolve through the file's parent folder; this
--     function operates on folder UUIDs only.

create or replace function get_effective_level(p_user uuid, p_folder uuid)
returns perm_level
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role        text;
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

  select role::text into v_role
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

    -- 2. Role grant applies when no personal grant exists at this ancestor.
    select level into v_role_level
    from permission_grants
    where folder_id = v_cursor
      and principal_type = 'role'
      and principal_id = v_role
      and (expires_at is null or expires_at > now())
    limit 1;

    if v_role_level is not null then
      return v_role_level;
    end if;

    -- 3. Climb to parent.
    select parent_id into v_cursor from folders where id = v_cursor;
  end loop;

  -- No ancestor had any applicable grant.
  return 'no_access';
end;
$$;
