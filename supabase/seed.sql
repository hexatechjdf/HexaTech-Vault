-- =============================================================================
-- seed.sql
--
-- DEPRECATED FOR FRESH INSTALLS.
-- -----------------------------------------------------------------------------
-- 1. The four canonical departments are now created by migration 0004
--    (renamed by 0014). Running this file's `insert into departments`
--    block is harmless (ON CONFLICT (id) DO NOTHING) but redundant — and
--    its hardcoded UUIDs do NOT match the auto-generated ones from 0004,
--    so this file's app_users inserts will then reference dept UUIDs that
--    don't exist and fail their FK.
-- 2. The app_users inserts ALSO reference auth.users UUIDs that don't
--    exist on a fresh install (Supabase Auth assigns its own). On a fresh
--    project, app_users would fail the FK to auth.users(id) and the whole
--    seed transaction would roll back.
--
-- Bottom line: DO NOT RUN THIS ON A FRESH INSTALL. Use
--   1) `supabase db push`                             (runs migrations)
--   2) Create the Super Admin via Authentication → Users in the Dashboard
--   3) `bootstrap_super_admin.sql`                    (links auth -> app_users)
-- ...then create everyone else through the app's User Management screen.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Departments (5) — fixed UUIDs (prefix d000...)
-- ---------------------------------------------------------------------------
insert into departments (id, name) values
  ('d0000000-0000-0000-0000-000000000001', 'Executive'),
  ('d0000000-0000-0000-0000-000000000002', 'HR & Admin'),
  ('d0000000-0000-0000-0000-000000000003', 'Projects'),
  ('d0000000-0000-0000-0000-000000000004', 'Development'),
  ('d0000000-0000-0000-0000-000000000005', 'Sales')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- App users (6) — fixed UUIDs (prefix u000...). These MUST match auth.users ids.
--   Zara Ahmed   super_admin  Executive    zara@hexatech.io
--   Omar Farooq  admin        HR & Admin   omar@hexatech.io
--   Sara Khan    manager      Projects     sara@hexatech.io
--   Ali Hassan   team_lead    Development  ali@hexatech.io
--   Raza Malik   lead_dev     Development  raza@hexatech.io
--   Hina Baig    team_member   Sales        hina@hexatech.io
-- ---------------------------------------------------------------------------
insert into app_users (id, name, email, role, department_id, avatar, status) values
  ('u0000000-0000-0000-0000-000000000001', 'Zara Ahmed',  'zara@hexatech.io', 'super_admin', 'd0000000-0000-0000-0000-000000000001', 'ZA', 'active'),
  ('u0000000-0000-0000-0000-000000000002', 'Omar Farooq', 'omar@hexatech.io', 'admin',       'd0000000-0000-0000-0000-000000000002', 'OF', 'active'),
  ('u0000000-0000-0000-0000-000000000003', 'Sara Khan',   'sara@hexatech.io', 'manager',     'd0000000-0000-0000-0000-000000000003', 'SK', 'active'),
  ('u0000000-0000-0000-0000-000000000004', 'Ali Hassan',  'ali@hexatech.io',  'team_lead',   'd0000000-0000-0000-0000-000000000004', 'AH', 'active'),
  ('u0000000-0000-0000-0000-000000000005', 'Raza Malik',  'raza@hexatech.io', 'lead_dev',    'd0000000-0000-0000-0000-000000000004', 'RM', 'active'),
  ('u0000000-0000-0000-0000-000000000006', 'Hina Baig',   'hina@hexatech.io', 'team_member',  'd0000000-0000-0000-0000-000000000005', 'HB', 'active')
on conflict (id) do nothing;
