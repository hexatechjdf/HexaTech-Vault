// GET /api/admin/folders/access-tree
//
// Super-Admin-only batch endpoint for the Folder Access Control screen.
//
// Replaces the previous N-call pattern (one drive-list per folder + one
// permissions-get per folder) with TWO direct SELECTs against the Postgres
// cache and the grants table. For a tree of ~13 folders this drops the page
// load from ~28 HTTP round-trips to 1.
//
// Why this is safe / fast:
//   - FolderAccessControl is super-admin only. They already see every folder
//     under the company root; no per-folder permission check is needed.
//   - The data lives entirely in Postgres (folders cache + permission_grants).
//     No Drive API calls are involved, so no rate-limit risk.
//   - The frontend builds the tree from the flat `folders` array client-side
//     using parent_id -> children, and looks up principal labels (user name,
//     role label) from data it already has loaded.
//
// Returns:
//   {
//     folders: Array<{ id, name, parent_id, is_root, path }>,
//     grants:  Array<{ id, folderId, principalType, principalId, level, expiresAt }>,
//   }

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = "force-dynamic";

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
  // Super admin always passes. Any other caller needs at least folder_access:view
  // at the tab level — that's how a Super Admin delegates "you can use the
  // Folder Access Control screen" to a non-super-admin. Without this, granting
  // folder_access:view/action on the Tab Access Control page had no effect
  // because this endpoint hard-required super_admin.
  if (caller.role !== "super_admin") {
    const level = await resolveTabLevel(caller.id, "folder_access");
    if (level === "no_access") return bad("Insufficient permission on Folder Access Control", 403);
  }

  // Admin client bypasses RLS so we get every folder / grant uniformly.
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  // Two parallel SELECTs. Each is a single round-trip.
  const [foldersRes, grantsRes] = await Promise.all([
    admin
      .from("folders")
      .select("id, name, parent_id, is_root, path")
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    admin
      .from("permission_grants")
      .select("id, folder_id, principal_type, principal_id, principal_dept_id, level, expires_at")
      // Skip expired grants - the engine ignores them anyway.
      .or("expires_at.is.null,expires_at.gt." + new Date().toISOString()),
  ]);

  if (foldersRes.error) return bad(foldersRes.error.message, 500);
  if (grantsRes.error) return bad(grantsRes.error.message, 500);

  const folders = (foldersRes.data ?? []).map((f) => ({
    id: f.id as string,
    name: f.name as string,
    parent_id: (f.parent_id as string | null) ?? null,
    is_root: !!f.is_root,
    path: (f.path as string | null) ?? null,
  }));

  const grants = (grantsRes.data ?? []).map((g) => ({
    id: g.id as string,
    folderId: g.folder_id as string,
    principalType: g.principal_type as "user" | "role",
    principalId: g.principal_id as string,
    // Migration 0021: role grants can be scoped to one department (or null
    // for "all departments"). User grants always have NULL here.
    principalDeptId: (g.principal_dept_id as string | null) ?? null,
    level: g.level as string,
    expiresAt: (g.expires_at as string | null) ?? null,
  }));

  return NextResponse.json({ folders, grants });
}
