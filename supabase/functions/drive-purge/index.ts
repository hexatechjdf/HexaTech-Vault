// drive-purge ({id, kind:'folder'|'file'}) - Super-Admin-only permanent
// delete of a soft-deleted item.
//
// Pre-condition: the item MUST already be soft-deleted (deleted_at IS NOT NULL).
// This endpoint is the "Delete forever" action surfaced from the Trash modal -
// it is NOT a shortcut for skipping the soft-delete step. The regular
// drive-delete must run first to populate Drive's Trash + set deleted_at.
//
// Flow:
//   auth -> super_admin gate -> verify row is soft-deleted -> assertWithinRoot
//   -> Drive files.delete (permanent; 404 is treated as success since the
//      item is already gone from Drive) -> DELETE the cache row (FK cascades
//      clean up permission_grants, folder_assignees, descendants) -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken, deleteFile } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    if (user.role !== "super_admin") {
      return errorResponse("Only the Super Admin can permanently delete items", 403);
    }

    const body = await req.json().catch(() => ({}));
    const { id, kind } = body;
    if (!id || (kind !== "folder" && kind !== "file")) {
      return errorResponse("id and kind ('folder'|'file') are required", 400);
    }

    const svc = serviceClient();

    let driveFileId: string;

    if (kind === "folder") {
      const { data: f } = await svc
        .from("folders")
        .select("id, drive_file_id, deleted_at, is_root")
        .eq("id", id)
        .maybeSingle();
      if (!f) return errorResponse("Folder not found", 404);
      if (f.is_root) return errorResponse("The root folder cannot be permanently deleted", 409);
      if (!f.deleted_at) {
        return errorResponse("Only items already in Trash can be permanently deleted", 409);
      }
      driveFileId = f.drive_file_id;
    } else {
      const { data: f } = await svc
        .from("files")
        .select("id, drive_file_id, deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (!f) return errorResponse("File not found", 404);
      if (!f.deleted_at) {
        return errorResponse("Only items already in Trash can be permanently deleted", 409);
      }
      driveFileId = f.drive_file_id;
    }

    const token = await getAccessToken();
    // assertWithinRoot may 404 if Drive already purged the file (auto-purge
    // after 30 days). That's fine - the bytes are gone, we still want to
    // hard-delete the DB row. Catch the specific case below.
    try {
      await assertWithinRoot(driveFileId, token);
      // Permanent delete on Drive. deleteFile() already treats 404 as success.
      await deleteFile(token, driveFileId);
    } catch (e) {
      const msg = (e as Error).message || "";
      // If the file is gone from Drive entirely, that's our desired end state
      // anyway - proceed to hard-delete the DB row. Anything else, rethrow.
      if (!/404/.test(msg)) throw e;
    }

    // Hard-delete the cache row. FK cascades clean up permission_grants,
    // folder_assignees, and child folders/files (defined in 0001_schema.sql).
    if (kind === "folder") {
      await svc.from("folders").delete().eq("id", id);
    } else {
      await svc.from("files").delete().eq("id", id);
    }

    await writeAudit({
      actorId: user.id,
      action: kind === "folder" ? "folder.purge" : "file.purge",
      resourceType: kind,
      resourceId: driveFileId,
      ipAddress: clientIp(req),
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-purge error:", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
