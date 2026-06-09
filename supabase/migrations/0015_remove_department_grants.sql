-- 0015_remove_department_grants.sql
--
-- Permission system is being narrowed to two principal types: 'user' and 'role'.
-- Departments are no longer a grant principal. This migration:
--   1. Deletes every existing department-typed grant from permission_grants.
--   2. The principal_type column itself stays as text (no enum to alter); the
--      Edge Functions reject new department grants via VALID_PRINCIPALS, and
--      this migration ensures the existing data is gone.
--
-- IMPORTANT EFFECT:
-- Anyone who previously had access through a department grant loses that
-- access at the moment this runs. Replace with explicit user grants or role
-- grants where needed.
--
-- get_effective_level() still contains the dept-grant branch (kept for now;
-- it just won't find any matching rows). A later migration can strip it as
-- part of the permission-system redesign.

delete from permission_grants
where principal_type = 'department';
