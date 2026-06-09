// drive-upload ({folderId, name, mimeType, contentBase64?}) — item 05.
// Requires `upload` (view_upload+) on the target folder. Creates the file in
// Drive (multipart for small base64 content, or metadata-only when no content
// is supplied) and caches a files row.
//
// auth -> permission(upload) -> assertWithinRoot -> create in Drive -> insert
// files row -> audit.
//
// TODO: large files must use Drive's RESUMABLE upload protocol. The base64
// path here is for SMALL files only — see google.ts uploadSmallFile().

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import {
  getAccessToken,
  createFileMetadata,
  uploadSmallFile,
} from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";
import { toFileDTO, FileRow } from "../_shared/dto.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId, name, mimeType, contentBase64 } = body;

    if (!folderId || !name) {
      return errorResponse("folderId and name are required", 400);
    }

    const svc = serviceClient();
    const { data: folder } = await svc
      .from("folders")
      .select("id, drive_file_id, deleted_at")
      .eq("id", folderId)
      .maybeSingle();
    if (!folder || folder.deleted_at) {
      return errorResponse("Folder not found", 404);
    }

    await requirePermission(user.id, folderId, "upload");

    const token = await getAccessToken();
    await assertWithinRoot(folder.drive_file_id, token);

    const effectiveMime = mimeType || "application/octet-stream";
    const driveFile = contentBase64
      ? await uploadSmallFile(token, name, effectiveMime, folder.drive_file_id, contentBase64)
      : await createFileMetadata(token, name, effectiveMime, folder.drive_file_id);

    const { data: inserted, error: insErr } = await svc
      .from("files")
      .insert({
        drive_file_id: driveFile.id,
        name: driveFile.name,
        mime_type: driveFile.mimeType ?? effectiveMime,
        size_bytes: driveFile.size ? Number(driveFile.size) : null,
        folder_id: folderId,
        uploaded_by: user.id,
        web_view_link: driveFile.webViewLink ?? null,
        modified_at: driveFile.modifiedTime ?? new Date().toISOString(),
      })
      .select(
        "id, drive_file_id, name, mime_type, size_bytes, folder_id, uploaded_by, web_view_link, modified_at",
      )
      .single();

    if (insErr || !inserted) {
      throw new HttpError(500, "File created in Drive but failed to cache metadata");
    }

    await writeAudit({
      actorId: user.id,
      action: "file.upload",
      resourceType: "file",
      resourceId: driveFile.id,
      details: { name, folderId, hasContent: !!contentBase64 },
      ipAddress: clientIp(req),
    });

    const dto = await toFileDTO(inserted as unknown as FileRow, user.id);
    return jsonResponse({ file: dto });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-upload error:", e);
    return errorResponse("Internal error", 500);
  }
});
