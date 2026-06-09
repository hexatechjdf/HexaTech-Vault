// assignees-remove ({folderId, userId}) (item 06).
// Atomically removes the assignee row AND the matching user grant so no orphaned
// permission_grants remain. Caller needs manage access (full_control) or
// super_admin.
//
// auth -> permission(manage_access) -> delete assignee + user grant -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId, userId } = body;
    if (!folderId || !userId) {
      return errorResponse("folderId and userId are required", 400);
    }

    await requirePermission(user.id, folderId, "manage_access");

    const svc = serviceClient();
    // Remove the assignee row.
    await svc
      .from("folder_assignees")
      .delete()
      .eq("folder_id", folderId)
      .eq("user_id", userId);
    // Remove the matching user grant (atomic revoke — item 06).
    await svc
      .from("permission_grants")
      .delete()
      .eq("folder_id", folderId)
      .eq("principal_type", "user")
      .eq("principal_id", userId);

    await writeAudit({
      actorId: user.id,
      action: "assignee.remove",
      resourceType: "folder",
      resourceId: folderId,
      details: { userId },
      ipAddress: clientIp(req),
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("assignees-remove error:", e);
    return errorResponse("Internal error", 500);
  }
});
