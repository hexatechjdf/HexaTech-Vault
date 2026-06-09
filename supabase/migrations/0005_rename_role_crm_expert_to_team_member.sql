-- ─────────────────────────────────────────────────────────────────────────────
-- 0005_rename_role_crm_expert_to_team_member.sql
-- Renames the `user_role` enum value `crm_expert` to `team_member`.
--
-- Why: "CRM Expert" overlapped with a department name and was role-confusing.
-- "Team Member" is the generic IC role; team membership is conveyed by the
-- user's `department_id`, not by a role tied to one function.
--
-- Postgres rewrites in-place: any existing `app_users` rows with
-- role = 'crm_expert' are automatically updated to 'team_member'.
-- ─────────────────────────────────────────────────────────────────────────────

alter type user_role rename value 'crm_expert' to 'team_member';
