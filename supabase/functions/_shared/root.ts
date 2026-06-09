// assertWithinRoot(driveFileId): security-critical guard (item 03) called by
// every Drive read/write Edge Function before acting. Confirms the target file
// lives inside the company root subtree. Prefers the cached folders.path /
// ancestor chain; falls back to walking Drive `parents` only when the item is
// not yet cached.

import { serviceClient } from "./supabase.ts";
import { HttpError } from "./auth.ts";
import { getFile } from "./google.ts";

/** Returns the connected company root_folder_id, or throws if not connected. */
export async function getRootFolderId(): Promise<string> {
  const { data } = await serviceClient()
    .from("drive_connection")
    .select("root_folder_id")
    .eq("id", true)
    .maybeSingle();
  if (!data?.root_folder_id) {
    throw new HttpError(409, "No Drive connection / root folder configured");
  }
  return data.root_folder_id;
}

/**
 * Throws HttpError(403) "Outside company root" unless driveFileId is the root
 * itself or a descendant of it.
 *
 * Strategy:
 *   1. If the id is the root id -> ok.
 *   2. If it is cached in folders/files, walk our cached parent chain (cheap).
 *   3. Otherwise resolve the ancestor chain via Drive `files.get?fields=parents`.
 *
 * @param accessToken optional — required only for the Drive fallback path.
 */
export async function assertWithinRoot(
  driveFileId: string,
  accessToken?: string,
): Promise<void> {
  const rootId = await getRootFolderId();
  if (driveFileId === rootId) return;

  const svc = serviceClient();

  // --- Cache path: is this a known folder? Walk our materialized chain. ---
  const { data: folderRow } = await svc
    .from("folders")
    .select("id, parent_id, drive_file_id, is_root")
    .eq("drive_file_id", driveFileId)
    .maybeSingle();

  if (folderRow) {
    if (folderRow.is_root) return; // it is the root
    // Walk up the cached tree until we hit the root or run out.
    let cursor: string | null = folderRow.parent_id;
    let guard = 0;
    while (cursor && guard++ < 256) {
      const { data: parent } = await svc
        .from("folders")
        .select("parent_id, drive_file_id, is_root")
        .eq("id", cursor)
        .maybeSingle();
      if (!parent) break;
      if (parent.is_root || parent.drive_file_id === rootId) return;
      cursor = parent.parent_id;
    }
    // Cached folder whose chain did not reach root -> outside.
    throw new HttpError(403, "Outside company root");
  }

  // --- Cache path: is this a known file? Its folder must be within root. ---
  const { data: fileRow } = await svc
    .from("files")
    .select("folder_id, folders(drive_file_id)")
    .eq("drive_file_id", driveFileId)
    .maybeSingle();
  if (fileRow?.folder_id) {
    // Recurse on the parent folder's drive id (cached).
    const { data: parentFolder } = await svc
      .from("folders")
      .select("drive_file_id")
      .eq("id", fileRow.folder_id)
      .maybeSingle();
    if (parentFolder?.drive_file_id) {
      return assertWithinRoot(parentFolder.drive_file_id, accessToken);
    }
  }

  // --- Drive fallback: not cached. Walk Drive parents up to the root. ---
  if (!accessToken) {
    throw new HttpError(403, "Outside company root (uncached; no token to verify)");
  }
  let currentId = driveFileId;
  let guard = 0;
  while (guard++ < 256) {
    const file = await getFile(accessToken, currentId);
    const parents = file.parents ?? [];
    if (parents.includes(rootId)) return;
    if (parents.length === 0) break; // reached a Drive top-level
    currentId = parents[0];
    if (currentId === rootId) return;
  }
  throw new HttpError(403, "Outside company root");
}
