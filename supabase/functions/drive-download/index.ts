// drive-download ({fileId}) — returns short-lived Drive links for a file.
// Requires `download` (view_download+) on the file's folder.
//
// auth -> permission(download) -> assertWithinRoot -> fetch fresh links -> audit.
//
// We return Drive's webViewLink / webContentLink rather than proxying bytes.
// These links still require the user to be authorized in Drive; since the app
// is the single Drive identity, the frontend should open them via the function
// or, for true byte streaming, a future streaming endpoint can be added. We do
// NOT return any Google access/refresh token.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken, getFile } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { fileId } = body; // local files.id (DB uuid)
    if (!fileId) return errorResponse("fileId is required", 400);

    const svc = serviceClient();
    const { data: file } = await svc
      .from("files")
      .select("id, drive_file_id, folder_id, name, deleted_at")
      .eq("id", fileId)
      .maybeSingle();
    if (!file || file.deleted_at) return errorResponse("File not found", 404);
    if (!file.folder_id) return errorResponse("File has no folder", 409);

    await requirePermission(user.id, file.folder_id, "download");

    const token = await getAccessToken();
    await assertWithinRoot(file.drive_file_id, token);

    // Fetch current links from Drive (they are time-limited by Google).
    const driveFile = await getFile(token, file.drive_file_id);

    await writeAudit({
      actorId: user.id,
      action: "file.download",
      resourceType: "file",
      resourceId: file.drive_file_id,
      details: { name: file.name },
      ipAddress: clientIp(req),
    });

    return jsonResponse({
      name: driveFile.name,
      mimeType: driveFile.mimeType,
      webViewLink: driveFile.webViewLink ?? null,
      webContentLink: driveFile.webContentLink ?? null,
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-download error:", e);
    return errorResponse("Internal error", 500);
  }
});
