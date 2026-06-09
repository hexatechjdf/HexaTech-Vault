-- 0010_user_google_email.sql
-- Adds a separate Google Drive email per user.
--
-- Why: the email used at app login can be a company / system address that
-- isn't tied to a Google identity (e.g. info@hexatechsolution.com), but Drive
-- can only share folders with real Google accounts. Each user now records the
-- Gmail / Workspace address they want Drive to share to. permissions-set
-- uses this column when granting access; falls back to email if unset.

alter table app_users
  add column if not exists google_email text;

comment on column app_users.google_email is
  'Google account email used for Drive sharing. Distinct from the login email so company / system addresses can still log in while Drive uses a real Google identity.';
