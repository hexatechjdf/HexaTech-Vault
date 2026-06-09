// SERVER ONLY — never import this from a client component or page.
// Importing this from anything bundled to the browser will leak the service-role key.

/**
 * Supabase ADMIN client (service-role).
 *
 * Wired infrastructure — login itself is intentionally NOT implemented yet.
 * See ../../../GETTING_STARTED.md auth plan. This client is reserved for privileged
 * operations the regular session cannot perform, e.g.:
 *   - super_admin user provisioning (`auth.admin.inviteUserByEmail`)
 *   - bootstrapping the company root folder
 *   - one-off maintenance tasks
 *
 * It uses the SERVICE ROLE key, which BYPASSES Row Level Security. Treat with care.
 */

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "@/lib/config";

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and (server-only) SUPABASE_SERVICE_ROLE_KEY."
    );
  }
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
