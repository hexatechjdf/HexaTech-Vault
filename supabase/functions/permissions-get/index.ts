// permissions-get ({folderId}) -> { grants: GrantDTO[] } (item 04).
// Returns all grants on a folder for the management UI. Caller must be able to
// manage access on the folder (full_control) or be super_admin.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { principalLabel, GrantDTO } from "../_shared/dto.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId } = body;
    if (!folderId) return errorResponse("folderId is required", 400);

    // Manage-access gate (full_control); super_admin passes via the engine.
    await requirePermission(user.id, folderId, "manage_access");

    const svc = serviceClient();
    const { data: rows } = await svc
      .from("permission_grants")
      .select("id, folder_id, principal_type, principal_id, principal_dept_id, level, expires_at")
      .eq("folder_id", folderId);

    // Resolve dept names once for any rows that carry a principal_dept_id so
    // the UI can render "Team Member · CRM" without an extra round-trip.
    const deptIds = Array.from(
      new Set((rows ?? [])
        .map((r) => r.principal_dept_id as string | null)
        .filter((id): id is string => !!id)),
    );
    const deptNames = new Map<string, string>();
    if (deptIds.length > 0) {
      const { data: depts } = await svc
        .from("departments")
        .select("id, name")
        .in("id", deptIds);
      for (const d of depts ?? []) deptNames.set(d.id, d.name);
    }

    const grants: GrantDTO[] = [];
    for (const r of rows ?? []) {
      const baseLabel = await principalLabel(r.principal_type, r.principal_id);
      const dept = r.principal_dept_id ? deptNames.get(r.principal_dept_id) : null;
      grants.push({
        id: r.id,
        folderId: r.folder_id,
        principalType: r.principal_type,
        principalId: r.principal_id,
        principalDeptId: (r.principal_dept_id as string | null) ?? null,
        // Decorate the label so the management UI shows "<role> · <dept>"
        // for scoped role grants. Unscoped grants render as before.
        principalLabel: dept ? `${baseLabel} · ${dept}` : baseLabel,
        level: r.level,
        expiresAt: r.expires_at,
      });
    }

    return jsonResponse({ grants });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("permissions-get error:", e);
    return errorResponse("Internal error", 500);
  }
});
