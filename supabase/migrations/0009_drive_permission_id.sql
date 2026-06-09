-- 0009_drive_permission_id.sql
-- Tracks the Google Drive permission id for user-principal grants so we can
-- revoke / update the Drive-side sharing when the app-side grant changes.
--
-- For dept/role grants the column stays null (no Drive call is made for those --
-- Drive shares are per-email, and dept/role grants don't pin a specific user).

alter table permission_grants
  add column if not exists drive_permission_id text;

comment on column permission_grants.drive_permission_id is
  'Google Drive permission id returned by permissions.create. Used to revoke / update the Drive share when this grant changes. Null for department / role grants.';
