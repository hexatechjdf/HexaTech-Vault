-- =============================================================================
-- 0027_default_file_manager_access.sql
--
-- BASELINE TAB ACCESS — every non-super-admin role gets "View + Action" on
-- File Manager by default.
--
-- Why: the whole product is "let users use Google Drive folders according to
-- their access". Without File Manager access they can't use the system at
-- all. Other tabs (User Management, Folder Access Control, Audit Logs,
-- Storage Overview, Settings, Tab Access Control) remain opt-in by the
-- Super Admin.
--
-- How:
--   - One UNSCOPED role grant per non-super-admin role on file_manager:action.
--   - Unscoped = NULL principal_dept_id = "applies to every user with this
--     role, in any department".
--   - The engine's precedence still applies. If the Super Admin wants to
--     restrict a specific user, they can set that user to view (or no_access)
--     in Tab Access Control; user grants always win over role grants.
--
-- Why a role grant, not per-user inserts? Because:
--   - Existing users get it for free without touching app_users.
--   - Future users get it for free without modifying the Create User flow.
--   - Revoking globally = delete one role grant; revoking per user =
--     standard "user wins" override via the Tab Access Control screen.
--
-- super_admin is intentionally NOT in this list — they already short-circuit
-- to 'action' on every tab (engine), so a grant would be a no-op. The
-- tab-permissions-set Edge Function actively rejects super_admin grants.
--
-- Idempotent: WHERE NOT EXISTS skips any role that's already been granted
-- this level. Re-running the migration is safe.
-- =============================================================================

insert into tab_permission_grants (tab, principal_type, principal_id, principal_dept_id, level)
select
  'file_manager'::tab_name,
  'role',
  r.role_name,
  null,
  'action'::tab_level
from (
  values
    ('admin'),
    ('manager'),
    ('team_lead'),
    ('lead_dev'),
    ('team_member')
) as r(role_name)
where not exists (
  select 1
  from tab_permission_grants existing
  where existing.tab            = 'file_manager'::tab_name
    and existing.principal_type = 'role'
    and existing.principal_id   = r.role_name
    and existing.principal_dept_id is null
);

-- Verify with:
--   select principal_id, level
--   from tab_permission_grants
--   where tab = 'file_manager' and principal_type = 'role'
--     and principal_dept_id is null
--   order by principal_id;
-- Expected: 5 rows (admin, lead_dev, manager, team_lead, team_member), all 'action'.
