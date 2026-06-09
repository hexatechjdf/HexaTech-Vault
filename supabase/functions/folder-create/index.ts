// folder-create (item 05) — Department -> Role -> Access creation flow.
// Input: { parentFolderId, name, ownerDepartmentId, roleContext?,
//          access: [{ principalType, principalId, level }] }
//
// auth -> permission(create_subfolder on parent) -> assertWithinRoot ->
// Drive createFolder -> insert folders row (owner_department_id, created_by,
// materialized path) -> apply grants + cross-dept folder_assignees ->
// forbid privilege escalation above caller's level (unless super_admin) ->
// audit. Rolls back the Drive folder if the DB insert fails.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  requirePermission,
  rankOf,
  PermLevel,
} from "../_shared/permissions.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken, createFolder, trashFile } from "../_shared/google.ts";
import { childPath } from "../_shared/paths.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";
import { toFolderDTO, FolderRow } from "../_shared/dto.ts";

interface AccessEntry {
  principalType: "user" | "department" | "role";
  principalId: string;
  level: PermLevel;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  let createdDriveId: string | null = null;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { parentFolderId, name, ownerDepartmentId, roleContext } = body;
    // Strip unsupported / meaningless grant entries from the incoming access
    // list so older clients keep working. Two cases:
    //   - department grants: principal type was removed
    //   - super_admin grants (role or user): super_admin already has
    //     full_control everywhere via the engine
    // permissions-set rejects these explicitly on the standalone path.
    const access: AccessEntry[] = (Array.isArray(body.access) ? body.access : [])
      .filter((a: AccessEntry) => a.principalType !== "department")
      .filter((a: AccessEntry) =>
        !(a.principalType === "role" && a.principalId === "super_admin")
      );

    if (!parentFolderId || !name || !ownerDepartmentId) {
      return errorResponse("parentFolderId, name and ownerDepartmentId are required", 400);
    }

    const svc = serviceClient();

    // Resolve the parent folder (must be a known, non-deleted folder).
    const { data: parent } = await svc
      .from("folders")
      .select("id, drive_file_id, deleted_at")
      .eq("id", parentFolderId)
      .maybeSingle();
    if (!parent || parent.deleted_at) {
      return errorResponse("Parent folder not found", 404);
    }

    // Permission gate: caller needs create capability on the parent.
    const callerLevel = await requirePermission(user.id, parentFolderId, "create_subfolder");

    // Root-scope guard (defense in depth, even though parent is a cached folder).
    const token = await getAccessToken();
    await assertWithinRoot(parent.drive_file_id, token);

    // Picking a non-default owning department is restricted to super_admin/manager.
    if (user.role !== "super_admin" && user.role !== "manager") {
      if (ownerDepartmentId !== user.department_id) {
        return errorResponse(
          "Only super_admin or manager may set a different owning department",
          403,
        );
      }
    }

    // Privilege-escalation guard: a creator cannot grant a level higher than
    // their own effective level on the new folder's parent (unless super_admin).
    if (user.role !== "super_admin") {
      for (const a of access) {
        if (rankOf(a.level) > rankOf(callerLevel)) {
          return errorResponse(
            `Cannot grant '${a.level}' — exceeds your own level '${callerLevel}'`,
            403,
          );
        }
      }
    }

    // ---- Create the folder in Drive ----
    const driveFolder = await createFolder(token, name, parent.drive_file_id);
    createdDriveId = driveFolder.id;

    // ---- Insert the folders row (with materialized path) ----
    const path = await childPath(parentFolderId, name);
    const { data: inserted, error: insErr } = await svc
      .from("folders")
      .insert({
        drive_file_id: driveFolder.id,
        name,
        parent_id: parentFolderId,
        is_root: false,
        owner_department_id: ownerDepartmentId,
        created_by: user.id,
        path,
      })
      .select("id, drive_file_id, name, parent_id, is_root, owner_department_id, path")
      .single();

    if (insErr || !inserted) {
      // Roll back the Drive folder so we never leave a ghost (item 05).
      try {
        await trashFile(token, driveFolder.id);
        createdDriveId = null; // already rolled back; don't double-trash in catch
      } catch (rb) {
        console.error("Rollback (trash) failed:", rb);
      }
      throw new HttpError(500, "Failed to persist folder; rolled back Drive folder");
    }

    const newFolderId = inserted.id;

    // ---- Apply access grants + cross-department assignees ----
    for (const a of access) {
      // Skip grants targeting a super_admin user - they already have
      // full_control everywhere by definition (engine short-circuits).
      if (a.principalType === "user") {
        const { data: targetUser } = await svc
          .from("app_users")
          .select("role")
          .eq("id", a.principalId)
          .maybeSingle();
        if (targetUser?.role === "super_admin") continue;
      }

      // Upsert the grant.
      await svc.from("permission_grants").upsert(
        {
          folder_id: newFolderId,
          principal_type: a.principalType,
          principal_id: a.principalId,
          level: a.level,
          granted_by: user.id,
        },
        { onConflict: "folder_id,principal_type,principal_id" },
      );

      // Cross-department members also become "Shared with me" assignees (item 06).
      if (a.principalType === "user") {
        const { data: member } = await svc
          .from("app_users")
          .select("department_id")
          .eq("id", a.principalId)
          .maybeSingle();
        if (member && member.department_id !== ownerDepartmentId) {
          await svc.from("folder_assignees").upsert(
            {
              folder_id: newFolderId,
              user_id: a.principalId,
              assigned_by: user.id,
            },
            { onConflict: "folder_id,user_id" },
          );
        }
      }
    }

    await writeAudit({
      actorId: user.id,
      action: "folder.create",
      resourceType: "folder",
      resourceId: driveFolder.id,
      details: { name, parentFolderId, ownerDepartmentId, roleContext, grants: access.length },
      ipAddress: clientIp(req),
    });

    const dto = await toFolderDTO(inserted as unknown as FolderRow, user.id);
    return jsonResponse({ folder: dto });
  } catch (e) {
    // Best-effort rollback if we created a Drive folder before failing late.
    if (createdDriveId) {
      try {
        const token = await getAccessToken();
        await trashFile(token, createdDriveId);
      } catch { /* leave reconciliation to next sync */ }
    }
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("folder-create error:", e);
    return errorResponse("Internal error", 500);
  }
});
