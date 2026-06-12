-- 0028_user_delete_set_null_fks.sql
--
-- Make hard-deleting an app_users row (cascaded from auth.users) succeed.
--
-- Background: every "who did this" column across the schema references
-- app_users(id) WITHOUT an ON DELETE clause. The Postgres default (NO ACTION)
-- blocks the delete the moment any of these tables has a row pointing at the
-- user being removed. That's why `auth.admin.deleteUser()` returns the
-- generic "Database error deleting user" — a child-row constraint aborts the
-- cascade.
--
-- Fix: switch every actor / created_by / updated_by / granted_by / assigned_by
-- column to ON DELETE SET NULL. History is preserved (the audit row still
-- shows "admin.user_create"), but the actor pointer goes null — the UI
-- already renders that as "System" / "(deleted user)".
--
-- We deliberately do NOT touch folder_assignees.user_id (already CASCADE —
-- assignments to a deleted user are no longer meaningful) nor permission_grants
-- principal columns (they're text-keyed, not real FKs).

begin;

-- 1. audit_log — biggest culprit, every action writes a row.
alter table audit_log
  drop constraint if exists audit_log_actor_id_fkey,
  add  constraint audit_log_actor_id_fkey
    foreign key (actor_id) references app_users(id) on delete set null;

-- 2. folders.created_by
alter table folders
  drop constraint if exists folders_created_by_fkey,
  add  constraint folders_created_by_fkey
    foreign key (created_by) references app_users(id) on delete set null;

-- 3. files.uploaded_by
alter table files
  drop constraint if exists files_uploaded_by_fkey,
  add  constraint files_uploaded_by_fkey
    foreign key (uploaded_by) references app_users(id) on delete set null;

-- 4. permission_grants.granted_by
alter table permission_grants
  drop constraint if exists permission_grants_granted_by_fkey,
  add  constraint permission_grants_granted_by_fkey
    foreign key (granted_by) references app_users(id) on delete set null;

-- 5. folder_assignees.assigned_by
--    NOTE: folder_assignees.user_id stays ON DELETE CASCADE (intentional).
alter table folder_assignees
  drop constraint if exists folder_assignees_assigned_by_fkey,
  add  constraint folder_assignees_assigned_by_fkey
    foreign key (assigned_by) references app_users(id) on delete set null;

-- 6. drive_connection.connected_by
alter table drive_connection
  drop constraint if exists drive_connection_connected_by_fkey,
  add  constraint drive_connection_connected_by_fkey
    foreign key (connected_by) references app_users(id) on delete set null;

-- 7. branding.updated_by
alter table branding
  drop constraint if exists branding_updated_by_fkey,
  add  constraint branding_updated_by_fkey
    foreign key (updated_by) references app_users(id) on delete set null;

-- 8. backup_config.updated_by
alter table backup_config
  drop constraint if exists backup_config_updated_by_fkey,
  add  constraint backup_config_updated_by_fkey
    foreign key (updated_by) references app_users(id) on delete set null;

-- 9. backup_runs.actor_id
alter table backup_runs
  drop constraint if exists backup_runs_actor_id_fkey,
  add  constraint backup_runs_actor_id_fkey
    foreign key (actor_id) references app_users(id) on delete set null;

-- 10. tab_permission_grants.granted_by
alter table tab_permission_grants
  drop constraint if exists tab_permission_grants_granted_by_fkey,
  add  constraint tab_permission_grants_granted_by_fkey
    foreign key (granted_by) references app_users(id) on delete set null;

commit;
