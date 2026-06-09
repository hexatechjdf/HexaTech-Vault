// drive-list ({folderId?}) — lists child folders + files of a folder (default
// the company root) with the caller's effective level on each, plus a
// breadcrumb. Read-only: requires `list` (view+) on the target folder.
//
// auth -> permission(list) -> root-scope (implicit: folders are root-scoped) ->
// read from cache -> return DTOs.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { getRootFolderId } from "../_shared/root.ts";
import {
  toFolderDTO,
  toFileDTO,
  FolderDTO,
  FolderRow,
  FileRow,
} from "../_shared/dto.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const svc = serviceClient();

    // Resolve the target folder (DB id). Default = root.
    let folderId: string | null = body.folderId ?? null;
    if (!folderId) {
      const rootDriveId = await getRootFolderId();
      const { data: root } = await svc
        .from("folders")
        .select("id")
        .eq("drive_file_id", rootDriveId)
        .maybeSingle();
      if (!root) return errorResponse("Root folder not synced yet", 409);
      folderId = root.id;
    }

    // Permission gate: caller must be able to list/view this folder.
    // requirePermission returns the resolved level, which we surface in the
    // response so the frontend can gate action buttons (New folder, Upload,
    // Manage access) by the caller's actual capabilities on THIS folder
    // instead of an assumption based on their role.
    const myLevelHere = await requirePermission(user.id, folderId, "list");

    // Child folders (non-deleted), with owner department name joined.
    const { data: folderRows } = await svc
      .from("folders")
      .select(
        "id, drive_file_id, name, parent_id, is_root, owner_department_id, path, updated_at, departments:owner_department_id(name)",
      )
      .eq("parent_id", folderId)
      .is("deleted_at", null)
      .order("name");

    // Child files (non-deleted).
    const { data: fileRows } = await svc
      .from("files")
      .select(
        "id, drive_file_id, name, mime_type, size_bytes, folder_id, uploaded_by, web_view_link, modified_at",
      )
      .eq("folder_id", folderId)
      .is("deleted_at", null)
      .order("name");

    // Compute item counts (direct children only) for each subfolder, so the
    // listing's "Size" column can show "N items". Two batched queries instead
    // of N+1: fetch every grandchild folder + file whose parent is one of the
    // subfolders we just listed, then group in JS.
    const subfolderIds = (folderRows ?? []).map((r) => r.id);
    const counts = new Map<string, number>();
    if (subfolderIds.length > 0) {
      const [{ data: nestedFolders }, { data: nestedFiles }] = await Promise.all([
        svc
          .from("folders")
          .select("parent_id")
          .in("parent_id", subfolderIds)
          .is("deleted_at", null),
        svc
          .from("files")
          .select("folder_id")
          .in("folder_id", subfolderIds)
          .is("deleted_at", null),
      ]);
      for (const r of (nestedFolders ?? []) as { parent_id: string | null }[]) {
        if (r.parent_id) counts.set(r.parent_id, (counts.get(r.parent_id) ?? 0) + 1);
      }
      for (const r of (nestedFiles ?? []) as { folder_id: string | null }[]) {
        if (r.folder_id) counts.set(r.folder_id, (counts.get(r.folder_id) ?? 0) + 1);
      }
    }

    const folders: FolderDTO[] = [];
    for (const r of (folderRows ?? []) as unknown as FolderRow[]) {
      const dto = await toFolderDTO(r, user.id, undefined, counts.get(r.id) ?? 0);
      // Hide folders the caller cannot see (defense in depth on top of the
      // parent's list gate; child grants may differ from the parent).
      if (dto.myLevel !== "no_access") folders.push(dto);
    }

    const files = [];
    for (const r of (fileRows ?? []) as unknown as FileRow[]) {
      files.push(await toFileDTO(r, user.id));
    }

    // Breadcrumb: walk parents up to the root.
    const breadcrumb = await buildBreadcrumb(svc, folderId);

    return jsonResponse({ folders, files, breadcrumb, myLevelHere });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-list error:", e);
    return errorResponse("Internal error", 500);
  }
});

/** Returns [{id,name}] from root down to the target folder. */
async function buildBreadcrumb(
  svc: ReturnType<typeof serviceClient>,
  folderId: string,
): Promise<{ id: string; name: string }[]> {
  const chain: { id: string; name: string }[] = [];
  let cursor: string | null = folderId;
  let guard = 0;
  while (cursor && guard++ < 256) {
    const { data } = await svc
      .from("folders")
      .select("id, name, parent_id")
      .eq("id", cursor)
      .maybeSingle();
    if (!data) break;
    chain.unshift({ id: data.id, name: data.name });
    cursor = data.parent_id;
  }
  return chain;
}
