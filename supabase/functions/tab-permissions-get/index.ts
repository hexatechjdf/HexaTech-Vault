// tab-permissions-get — Lists every tab grant. Super-admin only.
//
// The Tab Access Control UI renders a (principal x tab) matrix of grants. To
// keep the round-trip cheap we return all grants in one call; the UI does the
// per-(principal, tab) lookup client-side.
//
// auth -> super_admin check -> SELECT all grants joined with departments
//   (for display) -> respond.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface GrantRow {
  id: string;
  tab: string;
  principal_type: "user" | "role";
  principal_id: string;
  principal_dept_id: string | null;
  level: "no_access" | "view" | "action";
  granted_by: string | null;
  granted_at: string;
  departments: { name: string } | null;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);

    // Hard gate: only super_admin can list tab grants.
    const svc = serviceClient();
    const { data: caller } = await svc
      .from("app_users")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();
    if (!caller || caller.status !== "active") {
      throw new HttpError(403, "Account inactive");
    }
    if (caller.role !== "super_admin") {
      throw new HttpError(403, "Super admin only");
    }

    const { data, error } = await svc
      .from("tab_permission_grants")
      .select(
        "id, tab, principal_type, principal_id, principal_dept_id, level, granted_by, granted_at, departments:principal_dept_id(name)",
      )
      .order("granted_at", { ascending: false });

    if (error) throw new HttpError(500, error.message);

    const grants = ((data ?? []) as unknown as GrantRow[]).map((r) => ({
      id: r.id,
      tab: r.tab,
      principalType: r.principal_type,
      principalId: r.principal_id,
      principalDeptId: r.principal_dept_id,
      departmentName: r.departments?.name ?? null,
      level: r.level,
      grantedBy: r.granted_by,
      grantedAt: r.granted_at,
    }));

    return jsonResponse({ grants });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("tab-permissions-get error:", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
