-- 0017_retention_window_30days.sql
--
-- Retention window for soft-deleted folders / files bumps from 7 -> 30 days
-- to match Google Drive's own Trash retention. Super Admin can now recover
-- any deleted item within 30 days. On day 31, the existing
-- retention-purge-daily cron (scheduled in 0016) hard-deletes the row.
--
-- Two changes:
--   1. Default for the column changes to 30 so any fresh install starts at 30.
--   2. The existing singleton row is updated to 30 (idempotent: WHERE id = true).
--
-- Schedule itself (daily at 02:00 UTC) is unchanged.

alter table cron_config
  alter column retention_days set default 30;

update cron_config
set retention_days = 30
where id = true;
