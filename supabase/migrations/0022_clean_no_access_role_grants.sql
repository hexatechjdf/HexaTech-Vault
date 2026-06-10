-- =============================================================================
-- 0022_clean_no_access_role_grants.sql
--
-- Aligns existing data with the new permissions-set semantics: ROLE grants with
-- level='no_access' are no longer stored. The FAC dropdown's "No Access" option
-- is now equivalent to "no row exists" — selecting it triggers a DELETE rather
-- than an UPSERT. This avoids the trap where a Super Admin flicking the
-- dropdown to "No Access" silently creates a row that blocks every user with
-- that role+dept from inheriting an ancestor grant.
--
-- This migration purges any historical no_access role rows so the live data
-- matches the new behaviour. Without it, those rows would keep blocking users
-- even after the Edge Function is redeployed.
--
-- USER grants with level=no_access are PRESERVED — explicit revocation of a
-- specific user is a documented feature (see .claude/rules/permissions.md
-- "user grant beats role grant at the same node, both directions including
-- no_access revocation").
-- =============================================================================

delete from permission_grants
where principal_type = 'role'
  and level          = 'no_access';

-- Verify with:
--   select count(*) from permission_grants
--   where principal_type = 'role' and level = 'no_access';   -- expect 0
