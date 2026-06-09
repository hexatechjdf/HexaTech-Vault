// drive-delete ({id, kind:'folder'|'file'}) — trashes the item in Drive and
// sets deleted_at locally. Requires `delete` (full_control) on the item's folder.
//
// auth -> permission(delete) -> assertWithinRoot -> trash in Drive ->
// set deleted_at -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken, trashFile } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { id, kind } = body;
    if (!id || (kind !== "folder" && kind !== "file")) {
      return errorResponse("id and kind ('folder'|'file') are required", 400);
    }

    const svc = serviceClient();

    let driveFileId: string;
    let permFolderId: string; // folder whose permission governs this delete

    if (kind === "folder") {
      const { data: f } = await svc
        .from("folders")
        .select("id, drive_file_id, is_root, deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (!f || f.deleted_at) return errorResponse("Folder not found", 404);
      if (f.is_root) return errorResponse("The company root folder cannot be deleted", 403);
      driveFileId = f.drive_file_id;
      permFolderId = f.id; // need full_control on the folder itself to delete it
    } else {
      const { data: f } = await svc
        .from("files")
        .select("id, drive_file_id, folder_id, deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (!f || f.deleted_at) return errorResponse("File not found", 404);
      if (!f.folder_id) return errorResponse("File has no folder", 409);
      driveFileId = f.drive_file_id;
      permFolderId = f.folder_id;
    }

    // Delete is super_admin only - it's no longer a granted permission.
    // No other role can delete, regardless of their level on the folder.
    if (user.role !== "super_admin") {
      return errorResponse("Only the Super Admin can delete folders or files", 403);
    }

    const token = await getAccessToken();
    await assertWithinRoot(driveFileId, token);

    // Trash in Drive (reversible). Cascade-soft-delete is handled by next sync /
    // ON DELETE CASCADE for hard deletes; here we soft-delete the row.
    await trashFile(token, driveFileId);

    const now = new Date().toISOString();
    if (kind === "folder") {
      await svc.from("folders").update({ deleted_at: now }).eq("id", id);
      // Soft-delete cached descendants + files so the UI hides them immediately.
      await softDeleteSubtree(svc, id, now);
    } else {
      await svc.from("files").update({ deleted_at: now }).eq("id", id);
    }

    await writeAudit({
      actorId: user.id,
      action: kind === "folder" ? "folder.delete" : "file.delete",
      resourceType: kind,
      resourceId: driveFileId,
      ipAddress: clientIp(req),
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-delete error:", e);
    return errorResponse("Internal error", 500);
  }
});

/** Recursively soft-deletes child folders + files of a folder. */
async function softDeleteSubtree(
  svc: ReturnType<typeof serviceClient>,
  folderId: string,
  now: string,
): Promise<void> {
  await svc.from("files").update({ deleted_at: now }).eq("folder_id", folderId);
  const { data: children } = await svc
    .from("folders")
    .select("id")
    .eq("parent_id", folderId)
    .is("deleted_at", null);
  for (const c of children ?? []) {
    await svc.from("folders").update({ deleted_at: now }).eq("id", c.id);
    await softDeleteSubtree(svc, c.id, now);
  }
}
