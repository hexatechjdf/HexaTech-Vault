-- ─────────────────────────────────────────────────────────────────────────────
-- 0007_relax_drive_connection_immutability.sql
-- Removes the "Drive connection is permanent" lock so the super admin can
-- swap to a different Google account (or refresh consent after a revoked
-- refresh token) without manual DB surgery.
--
-- What changes:
--   1. Drop the trg_drive_connection_lock BEFORE-UPDATE/DELETE trigger.
--   2. Drop the now-unused prevent_connection_change() function.
--   3. Default `drive_connection.locked` to false. Existing rows are flipped
--      so we never accidentally re-trigger the (now-deleted) guard if it's
--      ever recreated.
--   4. Keep the singleton constraint (id boolean primary key default true).
--      We still want exactly one connection row; we just allow it to be
--      overwritten on reconnect via upsert.
-- ─────────────────────────────────────────────────────────────────────────────

drop trigger if exists trg_drive_connection_lock on drive_connection;
drop function if exists prevent_connection_change();

alter table drive_connection alter column locked set default false;
update drive_connection set locked = false where locked = true;
