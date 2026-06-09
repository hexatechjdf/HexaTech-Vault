// GET /api/admin/drive/trash
//
// Super-Admin-only. Returns the list of every soft-deleted folder and file
// currently in the recovery window, plus the configured retention window so
// the UI can show "Permanently deletes in N days".
//
// Returns: { items: TrashItem[], retentionDays: number }
//
// TrashItem = {
//   id:        DB UUID of the folders/files row
//   driveFileId: Drive's id (useful for an "Open in Drive Trash" link)
//   kind:      "folder" | "file"
//   name:      folder/file name at delete time
//   path:      materialized path at delete time (may be null for files)
//   deletedAt: ISO string
// }
//
// Sorted by deletedAt desc so most recent deletes appear first.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

  // Use admin client to read soft-deleted rows uniformly (RLS may hide them
  // from the user-scoped client depending on the policy).
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const [foldersRes, filesRes, configRes] = await Promise.all([
    admin
      .from("folders")
      .select("id, drive_file_id, name, path, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
    admin
      .from("files")
      .select("id, drive_file_id, name, deleted_at, folder_id, folders(path)")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
    admin
      .from("cron_config")
      .select("retention_days")
      .eq("id", true)
      .maybeSingle(),
  ]);

  if (foldersRes.error) return bad(foldersRes.error.message, 500);
  if (filesRes.error)   return bad(filesRes.error.message, 500);

  const items: Array<{
    id: string;
    driveFileId: string;
    kind: "folder" | "file";
    name: string;
    path: string | null;
    deletedAt: string;
  }> = [];

  for (const f of foldersRes.data ?? []) {
    items.push({
      id: f.id,
      driveFileId: f.drive_file_id,
      kind: "folder",
      name: f.name,
      path: f.path ?? null,
      deletedAt: f.deleted_at as string,
    });
  }

  for (const f of filesRes.data ?? []) {
    const parent = Array.isArray(f.folders) ? f.folders[0] : f.folders;
    items.push({
      id: f.id,
      driveFileId: f.drive_file_id,
      kind: "file",
      name: f.name,
      path: (parent as { path?: string } | null)?.path ?? null,
      deletedAt: f.deleted_at as string,
    });
  }

  // Re-sort the merged list by deletedAt desc (queries returned each kind
  // already sorted, but the merge needs re-sorting).
  items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));

  const retentionDays = configRes.data?.retention_days ?? 30;

  return NextResponse.json({ items, retentionDays });
}
