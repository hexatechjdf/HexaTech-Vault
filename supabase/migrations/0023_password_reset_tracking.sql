-- =============================================================================
-- 0023_password_reset_tracking.sql
--
-- Adds a single column to `app_users` so the forgot-password server action can
-- enforce a per-email cooldown (currently 60 seconds). Without it, a user
-- spamming the form (or an attacker hitting the endpoint in a tight loop)
-- could fire Supabase's auth.resetPasswordForEmail repeatedly, burn through
-- the project's email quota, and flood the target user's inbox.
--
-- The column is set every time a reset email is actually dispatched. The
-- action consults it before calling Supabase Auth; if the value is fresher
-- than the cooldown window, it silently no-ops and still returns the generic
-- "if that email exists, you'll receive a link" message.
--
-- No new RLS: the column is read/written only by server actions via the
-- service-role admin client. Clients never see it.
-- =============================================================================

alter table app_users
  add column if not exists password_reset_requested_at timestamptz;

-- Optional index for fast cooldown checks if traffic grows. Cheap to keep.
create index if not exists idx_app_users_password_reset_requested_at
  on app_users (password_reset_requested_at)
  where password_reset_requested_at is not null;
