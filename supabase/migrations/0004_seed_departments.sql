-- ─────────────────────────────────────────────────────────────────────────────
-- 0004_seed_departments.sql
-- Establishes the canonical set of departments for HexaTech Vault and
-- migrates any existing rows pointing at now-removed departments.
--
-- Canonical list (alphabetical):
--   CRM Expert | Custom Development | Finance | HR
--
-- Notes:
--   - "CRM Expert" appears here as a department AND is a separate role name.
--     They are independent concepts; the schema does not require them to match.
--   - This migration is idempotent. ON CONFLICT (name) DO NOTHING handles re-runs.
--   - permission_grants.principal_id is polymorphic text (no FK), so orphan
--     department grants would not be caught by the FK and are cleaned up below.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Ensure the four wanted departments exist.
insert into departments (name) values
  ('Custom Development'),
  ('CRM Expert'),
  ('Finance'),
  ('HR')
on conflict (name) do nothing;

-- 2) Move any users currently on a department about to be removed
--    onto 'Custom Development' (so the FK does not block the delete).
update app_users
set department_id = (select id from departments where name = 'Custom Development')
where department_id in (
  select id from departments
  where name not in ('Custom Development', 'CRM Expert', 'Finance', 'HR')
);

-- 3) Same defensive remap for folder ownership.
update folders
set owner_department_id = (select id from departments where name = 'Custom Development')
where owner_department_id in (
  select id from departments
  where name not in ('Custom Development', 'CRM Expert', 'Finance', 'HR')
);

-- 4) Remove polymorphic grants pointing at soon-to-be-deleted departments.
delete from permission_grants
where principal_type = 'department'
  and principal_id not in (
    select id::text from departments
    where name in ('Custom Development', 'CRM Expert', 'Finance', 'HR')
  );

-- 5) Drop the unwanted departments.
delete from departments
where name not in ('Custom Development', 'CRM Expert', 'Finance', 'HR');
