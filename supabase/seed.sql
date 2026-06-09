-- =============================================================================
-- seed.sql — demo departments + app_users for HexaTech Vault.
-- Deterministic UUIDs so the frontend and Supabase Auth can reference them.
--
-- IMPORTANT: app_users.id REFERENCES auth.users(id). You MUST create matching
-- Supabase Auth users with the SAME UUIDs listed below BEFORE (or together
-- with) this seed, otherwise the app_users inserts will fail the FK.
-- See SETUP.md "Create auth users" for the exact CLI/SQL commands. The auth
-- user's id must equal the app_user id; the email must match too.
--
-- Emails follow the project convention <first>@hexatech.io (from src/app/App.tsx).
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
