// assignees-list ({folderId}) -> { assignees: AssigneeDTO[] } (item 06).
// Returns the folder's cross-department assignees with their effective level.
// Caller must be able to manage access (full_control) or be super_admin.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission, getEffectiveLevel } from "../_shared/permissions.ts";
import { AssigneeDTO } from "../_shared/dto.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId } = body;
    if (!folderId) return errorResponse("folderId is required", 400);

    await requirePermission(user.id, folderId, "manage_access");

    const svc = serviceClient();
    const { data: rows } = await svc
      .from("folder_assignees")
      .select("user_id, app_users:user_id(name, departments:department_id(name))")
      .eq("folder_id", folderId);

    const assignees: AssigneeDTO[] = [];
    for (const r of (rows ?? []) as any[]) {
      const level = await getEffectiveLevel(r.user_id, folderId);
      assignees.push({
        userId: r.user_id,
        name: r.app_users?.name ?? r.user_id,
        department: r.app_users?.departments?.name ?? null,
        level,
      });
    }

    return jsonResponse({ assignees });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("assignees-list error:", e);
    return errorResponse("Internal error", 500);
  }
});
