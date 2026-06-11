-- ─────────────────────────────────────────────────────────────────────────────
-- HexaTech Vault — Super Admin bootstrap
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this ONCE, after creating the first Super Admin via the Supabase Dashboard
-- (Authentication → Users → Add user, with "Auto Confirm User" ticked).
--
-- Why this is needed:
--   - We have signup disabled (app_users are provisioned by an admin).
--   - The very first super admin can't be created through the app — chicken & egg.
--   - This script links a freshly-created auth.users row to an app_users row with
--     role='super_admin'. From that point on, the Super Admin creates everyone
--     else via the Next.js BFF at POST /api/admin/users.
--
-- Steps you take:
--   1) In the Supabase Dashboard:
--        Authentication → Users → Add user
--          email:    <super-admin email>      (e.g. zara@hexatech.io)
--          password: <strong password>
--          ✅ Auto Confirm User
--      → Save, then copy the new user's UUID from the Users table.
--
--   2) If you already ran `supabase/seed.sql` and it inserted a placeholder
--      app_users row with the same email, remove it first:
--           DELETE FROM app_users WHERE email = '<super-admin email>';
--      (or `TRUNCATE app_users CASCADE;` to reset all demo profiles).
--
--   3) Edit the variables below, then run this entire script in the SQL Editor.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_auth_uuid     uuid   := '<PASTE_AUTH_USER_UUID_HERE>';     -- from step 1
  v_name          text   := 'Zara Ahmed';                       -- display name
  v_email         text   := 'zara@hexatech.io';                 -- must match auth user
  v_avatar        text   := 'ZA';                               -- 2-letter initials
  -- Must be one of the departments created by migration 0004 (CRM Expert,
  -- Custom Development, HR) or its 0014 rename (WordPress). Pick whichever
  -- the Super Admin belongs to operationally.
  v_department    text   := 'HR';
  v_department_id uuid;
BEGIN
  SELECT id INTO v_department_id FROM departments WHERE name = v_department;
  IF v_department_id IS NULL THEN
    RAISE EXCEPTION 'Department "%" not found. Run the seed.sql first (or create the department).', v_department;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_auth_uuid) THEN
    RAISE EXCEPTION 'No auth.users row with id %. Did you create the user in Authentication → Users first?', v_auth_uuid;
  END IF;

  INSERT INTO app_users (id, name, email, role, department_id, avatar, status)
  VALUES (v_auth_uuid, v_name, v_email, 'super_admin', v_department_id, v_avatar, 'active')
  ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
        email = EXCLUDED.email,
        role = 'super_admin',
        department_id = EXCLUDED.department_id,
        avatar = EXCLUDED.avatar,
        status = 'active';

  RAISE NOTICE 'Super Admin bootstrapped: % <%>', v_name, v_email;
END $$;
