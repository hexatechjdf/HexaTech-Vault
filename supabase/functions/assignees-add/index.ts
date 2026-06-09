// assignees-add ({folderId, userId, level}) (item 06).
// Adds a cross-department assignee: inserts folder_assignees + a matching
// permission_grants (user grant). Caller needs manage access (full_control) or
// super_admin. Escalation guard applies to non-super_admins.
//
// auth -> permission(manage_access) -> escalation guard -> insert assignee +
// grant -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission, rankOf, PermLevel } from "../_shared/permissions.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

const VALID_LEVELS: PermLevel[] = [
  "no_access",
  "view",
  "view_download",
  "view_upload",
  "contributor",
  "full_control",
];

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId, userId, level } = body;
    if (!folderId || !userId || !level) {
      return errorResponse("folderId, userId and level are required", 400);
    }
    if (!VALID_LEVELS.includes(level)) {
      return errorResponse("Invalid level", 400);
    }

    const callerLevel = await requirePermission(user.id, folderId, "manage_access");
    if (user.role !== "super_admin" && rankOf(level as PermLevel) > rankOf(callerLevel)) {
      return errorResponse(
        `Cannot grant '${level}' — exceeds your own level '${callerLevel}'`,
        403,
      );
    }

    const svc = serviceClient();

    // Validate the target user exists.
    const { data: member } = await svc
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (!member) return errorResponse("User not found", 404);

    // Insert/refresh the assignee row.
    await svc.from("folder_assignees").upsert(
      { folder_id: folderId, user_id: userId, assigned_by: user.id },
      { onConflict: "folder_id,user_id" },
    );

    // Insert/refresh the matching user grant.
    await svc.from("permission_grants").upsert(
      {
        folder_id: folderId,
        principal_type: "user",
        principal_id: userId,
        level,
        granted_by: user.id,
      },
      { onConflict: "folder_id,principal_type,principal_id" },
    );

    await writeAudit({
      actorId: user.id,
      action: "assignee.add",
      resourceType: "folder",
      resourceId: folderId,
      details: { userId, level },
      ipAddress: clientIp(req),
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("assignees-add error:", e);
    return errorResponse("Internal error", 500);
  }
});
