-- 0011_role_dept_audit_rules.sql
-- Two related rule changes:
--   1. Super Admin and Admin do not belong to a department. Null out any
--      existing department_id on those rows so the data matches the intent.
--   2. Admin audit log visibility switches from same-department to rank-based:
--      admins see their own rows + every row whose actor is below admin in
--      rank (manager, team_lead, lead_dev, team_member). They do NOT see
--      other admins or super_admins.
--
-- Super Admin's audit policy (sees everything) is unchanged.

-- 1. Data: super_admin and admin do not belong to a department.
update app_users
set department_id = null
where role in ('super_admin', 'admin');

-- 2. RLS: drop the old dept-based admin policy and install the rank-based one.
drop policy if exists audit_select_admin_department on audit_log;

create policy audit_select_admin_subordinates
  on audit_log for select
  to authenticated
  using (
    -- Caller must currently be an admin.
    exists (
      select 1 from app_users
      where id = auth.uid()
        and role = 'admin'
    )
    and (
      -- Their own actions.
      audit_log.actor_id = auth.uid()
      OR
      -- Or actions taken by someone with a sub-admin role.
      exists (
        select 1 from app_users
        where id = audit_log.actor_id
          and role in ('manager', 'team_lead', 'lead_dev', 'team_member')
      )
    )
  );
