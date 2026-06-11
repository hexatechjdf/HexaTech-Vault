// Server-only helpers for enforcing tab permissions in BFF route handlers.
//
//   resolveTabLevel(userId, tab)
//     Calls the SQL function get_effective_tab_level(uuid, tab_name) via the
//     service-role client (bypasses RLS). Returns the effective level.
//
//   requireTabLevel(req, tab, requiredLevel)
//     Higher-level convenience used by mutation routes. Reads the caller from
//     the cookie session, resolves their level, and returns a NextResponse
//     401/403 if they don't meet the bar. Returns { userId, level } on success
//     so the route can keep going.
//
// Defence-in-depth layer 4 (see .claude/rules/permissions.md "Tab Permission
// System"). This is the layer that actually matters for security; nav + route
// gating are convenience.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { TabName, TabLevel } from "@/lib/tabs";

const LEVEL_RANK: Record<TabLevel, number> = {
  no_access: 0,
  view: 1,
  action: 2,
};

/** Calls get_effective_tab_level(uuid, tab_name) and returns the level. */
export async function resolveTabLevel(userId: string, tab: TabName): Promise<TabLevel> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc("get_effective_tab_level", {
    p_user: userId,
    p_tab: tab,
  });
  if (error) {
    console.error("resolveTabLevel error:", error);
    return "no_access";
  }
  return (data ?? "no_access") as TabLevel;
}

/**
 * Returns { userId, level } when the caller meets or exceeds requiredLevel,
 * otherwise returns a NextResponse with the right status code that the route
 * should return immediately.
 *
 * Usage:
 *   const gate = await requireTabLevel(req, "user_management", "action");
 *   if (gate instanceof NextResponse) return gate;
 *   const { userId, level } = gate;
 */
export async function requireTabLevel(
  _req: Request,
  tab: TabName,
  requiredLevel: TabLevel,
): Promise<{ userId: string; level: TabLevel } | NextResponse> {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Super-admin short-circuits before we even hit the engine — they always
  // pass. Cheap fast-path so we don't query for every super-admin click.
  const { data: caller } = await supabase
    .from("app_users")
    .select("role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }
  if (caller.role === "super_admin") {
    return { userId: authUser.id, level: "action" };
  }

  const level = await resolveTabLevel(authUser.id, tab);
  if (LEVEL_RANK[level] < LEVEL_RANK[requiredLevel]) {
    return NextResponse.json(
      { error: `Insufficient permission on ${tab}` },
      { status: 403 },
    );
  }
  return { userId: authUser.id, level };
}
