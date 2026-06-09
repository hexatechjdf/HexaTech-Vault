-- 0014_rename_finance_to_wordpress.sql
-- Renames the 'Finance' department to 'WordPress'.
--
-- This is a name change, NOT a swap of rows: the departments.id UUID stays
-- the same, so every existing foreign-key reference continues to point at
-- the same row:
--   - app_users.department_id
--   - folders.owner_department_id
--   - permission_grants.principal_id  (polymorphic text; matched by uuid::text)
--   - folder_assignees.assigned_by    (unaffected, references app_users)
--
-- Idempotent: the WHERE clause only matches the old name. Re-running this
-- migration after the rename is a no-op.
--
-- Note: 0004_seed_departments.sql still lists 'Finance' in its canonical
-- four-department insert because modifying applied migrations breaks
-- Supabase's content-hash check. Fresh installs will run 0004 (creates
-- Finance) then 0014 (renames to WordPress), arriving at the correct state.

update departments
set name = 'WordPress'
where name = 'Finance';
