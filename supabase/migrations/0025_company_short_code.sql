-- 0025_company_short_code.sql
--
-- Refines the meaning of `branding.proposal_label`. It is now used as the
-- ORGANIZATION CODE token in proposal naming, not the full "JDF Proposal"
-- phrase. The Edge Function (proposal-clone) appends " Proposal - Master Doc"
-- to the file name on its own, so the label only needs to be the short code.
--
-- Examples after this change:
--   Folder: "Jeff Bear - LogoQR - JDF"
--   File:   "Jeff Bear - LogoQR - JDF Proposal - Master Doc.docx"
--
-- Default drops from 'JDF Proposal' to 'JDF'. The existing row is updated
-- ONLY IF it still equals the previous default — so any Super Admin who has
-- already customized the value keeps their custom string.

alter table branding
  alter column proposal_label set default 'JDF';

update branding
set proposal_label = 'JDF'
where id = true
  and proposal_label = 'JDF Proposal';
