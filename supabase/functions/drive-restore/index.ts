// drive-restore ({id, kind:'folder'|'file'}) - restores a soft-deleted item.
// Super Admin only.
//
// auth -> super_admin gate -> verify row is soft-deleted -> assertWithinRoot
//   -> untrash in Drive -> clear deleted_at on the row -> for folders,
//   cascade-restore every descendant that was soft-deleted in the same
//   operation (matched by exact deleted_at timestamp) -> audit.
//
// Cascade match logic: when drive-delete soft-deletes a folder, the same
// `now` ISO string is written to every descendant in one synchronous pass,
// so all those rows share an identical deleted_at value. Restoring matches
// on equality so an item that was independently deleted before the parent
// (different timestamp) stays deleted.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken, untrashFile } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    if (user.role !== "super_admin") {
      return errorResponse("Only the Super Admin can restore items", 403);
    }

    const body = await req.json().catch(() => ({}));
    const { id, kind } = body;
    if (!id || (kind !== "folder" && kind !== "file")) {
      return errorResponse("id and kind ('folder'|'file') are required", 400);
    }

    const svc = serviceClient();

    let driveFileId: string;
    let originalDeletedAt: string;

    if (kind === "folder") {
      const { data: f } = await svc
        .from("folders")
        .select("id, drive_file_id, deleted_at, is_root")
        .eq("id", id)
        .maybeSingle();
      if (!f) return errorResponse("Folder not found", 404);
      if (f.is_root) return errorResponse("The root folder cannot be restored (was never deletable)", 409);
      if (!f.deleted_at) return errorResponse("Folder is not deleted", 409);
      driveFileId = f.drive_file_id;
      originalDeletedAt = f.deleted_at;
    } else {
      const { data: f } = await svc
        .from("files")
        .select("id, drive_file_id, deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (!f) return errorResponse("File not found", 404);
      if (!f.deleted_at) return errorResponse("File is not deleted", 409);
      driveFileId = f.drive_file_id;
      originalDeletedAt = f.deleted_at;
    }

    const token = await getAccessToken();
    // Drive holds trashed items for 30 days. If we're past that window the
    // Drive call below will 404; the calling layer converts HttpError to
    // a 4xx response with our message.
    await assertWithinRoot(driveFileId, token);
    await untrashFile(token, driveFileId);

    // Clear the row itself.
    if (kind === "folder") {
      await svc.from("folders").update({ deleted_at: null }).eq("id", id);
      // Cascade-restore descendants that were deleted together.
      await restoreSubtree(svc, id, originalDeletedAt);
    } else {
      await svc.from("files").update({ deleted_at: null }).eq("id", id);
    }

    await writeAudit({
      actorId: user.id,
      action: kind === "folder" ? "folder.restore" : "file.restore",
      resourceType: kind,
      resourceId: driveFileId,
      ipAddress: clientIp(req),
    });

    return jsonResponse({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-restore error:", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});

/**
 * Recursively clears deleted_at on descendants whose deleted_at matches the
 * parent's, i.e. they were soft-deleted in the same cascade. Items
 * independently deleted before the parent are not touched.
 */
async function restoreSubtree(
  svc: ReturnType<typeof serviceClient>,
  folderId: string,
  matchDeletedAt: string,
): Promise<void> {
  // Files directly under this folder, deleted at the same moment.
  await svc
    .from("files")
    .update({ deleted_at: null })
    .eq("folder_id", folderId)
    .eq("deleted_at", matchDeletedAt);

  // Child folders, deleted at the same moment, then recurse.
  const { data: children } = await svc
    .from("folders")
    .select("id")
    .eq("parent_id", folderId)
    .eq("deleted_at", matchDeletedAt);

  for (const c of children ?? []) {
    await svc.from("folders").update({ deleted_at: null }).eq("id", c.id);
    await restoreSubtree(svc, c.id, matchDeletedAt);
  }
}
