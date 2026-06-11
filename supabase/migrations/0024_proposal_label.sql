-- 0024_proposal_label.sql
--
-- Adds `proposal_label` to the singleton `branding` row. This is the suffix
-- attached to cloned proposal folder names: by default the folder convention
-- is "<Client> - <Project> - JDF Proposal", but if the organization renames
-- the proposal product line in the future the Super Admin can update this
-- value in Settings → Company Info without a code change.
--
-- Default value matches the convention requested by the CRM department.
-- Read access: same as the rest of branding (any authenticated user; the
-- /login page also reads it via the public GET). Write access: super_admin
-- only (existing RLS policy on the table).

alter table branding
  add column if not exists proposal_label text not null default 'JDF Proposal';
