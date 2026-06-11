// GET /api/admin/tabs/me
//
// Returns the current cookie-session user's effective level on every tab in
// the registry, as a `{ [tab]: level }` map. Used by:
//   - Layout.tsx        to gate the nav
//   - middleware.ts (indirect, via cached cookie or a per-route check)
//   - tab page bodies   to enable/disable action buttons
//
// Implementation: calls the SQL function `get_my_tab_access(uuid)` directly
// (SECURITY DEFINER, returns 6 rows). No Edge Function needed.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TabName, TabLevel } from "@/lib/tabs";

export const dynamic = "force-dynamic";

interface TabRow {
  tab: TabName;
  level: TabLevel;
}

export async function GET() {
  // Resolve the current user from the cookie session.
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Use the admin client to call the RPC so RLS is irrelevant — the function
  // itself is SECURITY DEFINER and only reads the caller's own access. We
  // pass the user id as the argument, so the function can't be tricked into
  // returning another user's grants from this path.
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "Admin client unavailable" }, { status: 500 });
  }

  const { data, error } = await admin.rpc("get_my_tab_access", { p_user: authUser.id });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as TabRow[];
  const tabs: Record<TabName, TabLevel> = {
    user_management: "no_access",
    folder_access: "no_access",
    file_manager: "no_access",
    audit_logs: "no_access",
    storage_overview: "no_access",
    settings: "no_access",
  };
  for (const r of rows) tabs[r.tab] = r.level;

  return NextResponse.json({ tabs });
}
