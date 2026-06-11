// GET /api/admin/users/[id]/effective-access
//
// Returns every folder grant AND every tab grant that effectively applies
// to the target user, with a clear "source" label so the UI can split
// inherited (role+dept or role-unscoped) from direct (per-user) grants.
//
// Used by the "User Profile (Effective Access)" view inside Folder Access
// Control + User Management.
//
// Auth: super_admin OR user_management:view (anyone who can use the user
// management screen can inspect a user's access).

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { resolveTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = "force-dynamic";

interface FolderGrantRow {
  id: string;
  folder_id: string;
  principal_type: string;
  principal_id: string;
  principal_dept_id: string | null;
  level: string;
  folders: { name: string; path: string } | null;
  departments: { name: string } | null;
}

interface TabGrantRow {
  id: string;
  tab: string;
  principal_type: string;
  principal_id: string;
  principal_dept_id: string | null;
  level: string;
  departments: { name: string } | null;
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const targetId = params.id;
  if (!targetId) return bad("User id is required", 400);

  // 1) Caller auth.
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  // Super_admin OR user_management view+ may inspect any user.
  if (caller.role !== "super_admin") {
    const level = await resolveTabLevel(caller.id, "user_management");
    if (level === "no_access") return bad("Insufficient permission on User Management", 403);
  }

  // 2) Load target user.
  const admin = createSupabaseAdminClient();
  const { data: target } = await admin
    .from("app_users")
    .select("id, name, email, role, department_id, departments:department_id(name)")
    .eq("id", targetId)
    .maybeSingle();
  if (!target) return bad("User not found", 404);

  const targetRole = target.role as string;
  const targetDeptId = target.department_id as string | null;

  // 3) Folder grants — three buckets.
  // Direct user grants (always for this specific user).
  const { data: directFolderRows } = await admin
    .from("permission_grants")
    .select("id, folder_id, principal_type, principal_id, principal_dept_id, level, folders:folder_id(name, path), departments:principal_dept_id(name)")
    .eq("principal_type", "user")
    .eq("principal_id", target.id);

  // Inherited via role+dept (only if target has a department).
  let roleDeptFolderRows: FolderGrantRow[] = [];
  if (targetDeptId) {
    const { data } = await admin
      .from("permission_grants")
      .select("id, folder_id, principal_type, principal_id, principal_dept_id, level, folders:folder_id(name, path), departments:principal_dept_id(name)")
      .eq("principal_type", "role")
      .eq("principal_id", targetRole)
      .eq("principal_dept_id", targetDeptId);
    roleDeptFolderRows = (data ?? []) as unknown as FolderGrantRow[];
  }

  // Inherited via role-unscoped.
  const { data: roleUnscopedFolderRows } = await admin
    .from("permission_grants")
    .select("id, folder_id, principal_type, principal_id, principal_dept_id, level, folders:folder_id(name, path), departments:principal_dept_id(name)")
    .eq("principal_type", "role")
    .eq("principal_id", targetRole)
    .is("principal_dept_id", null);

  // 4) Tab grants — same three buckets.
  const { data: directTabRows } = await admin
    .from("tab_permission_grants")
    .select("id, tab, principal_type, principal_id, principal_dept_id, level, departments:principal_dept_id(name)")
    .eq("principal_type", "user")
    .eq("principal_id", target.id);

  let roleDeptTabRows: TabGrantRow[] = [];
  if (targetDeptId) {
    const { data } = await admin
      .from("tab_permission_grants")
      .select("id, tab, principal_type, principal_id, principal_dept_id, level, departments:principal_dept_id(name)")
      .eq("principal_type", "role")
      .eq("principal_id", targetRole)
      .eq("principal_dept_id", targetDeptId);
    roleDeptTabRows = (data ?? []) as unknown as TabGrantRow[];
  }

  const { data: roleUnscopedTabRows } = await admin
    .from("tab_permission_grants")
    .select("id, tab, principal_type, principal_id, principal_dept_id, level, departments:principal_dept_id(name)")
    .eq("principal_type", "role")
    .eq("principal_id", targetRole)
    .is("principal_dept_id", null);

  // 5) Shape the response.
  function mapFolder(row: FolderGrantRow, source: "direct" | "role_dept" | "role_unscoped") {
    return {
      id: row.id,
      folderId: row.folder_id,
      folderName: row.folders?.name ?? "—",
      folderPath: row.folders?.path ?? "",
      level: row.level,
      source,
      via: source === "role_dept" ? `${targetRole} · ${row.departments?.name ?? "—"}`
         : source === "role_unscoped" ? `${targetRole} · All departments`
         : "Direct user grant",
    };
  }

  function mapTab(row: TabGrantRow, source: "direct" | "role_dept" | "role_unscoped") {
    return {
      id: row.id,
      tab: row.tab,
      level: row.level,
      source,
      via: source === "role_dept" ? `${targetRole} · ${row.departments?.name ?? "—"}`
         : source === "role_unscoped" ? `${targetRole} · All departments`
         : "Direct user grant",
    };
  }

  const targetDept = (target as unknown as { departments: { name: string } | null }).departments;

  return NextResponse.json({
    user: {
      id: target.id,
      name: target.name,
      email: target.email,
      role: target.role,
      departmentId: target.department_id,
      departmentName: targetDept?.name ?? null,
    },
    folders: {
      direct: ((directFolderRows ?? []) as unknown as FolderGrantRow[]).map((r) => mapFolder(r, "direct")),
      inheritedRoleDept: roleDeptFolderRows.map((r) => mapFolder(r, "role_dept")),
      inheritedRoleUnscoped: ((roleUnscopedFolderRows ?? []) as unknown as FolderGrantRow[]).map((r) => mapFolder(r, "role_unscoped")),
    },
    tabs: {
      direct: ((directTabRows ?? []) as unknown as TabGrantRow[]).map((r) => mapTab(r, "direct")),
      inheritedRoleDept: roleDeptTabRows.map((r) => mapTab(r, "role_dept")),
      inheritedRoleUnscoped: ((roleUnscopedTabRows ?? []) as unknown as TabGrantRow[]).map((r) => mapTab(r, "role_unscoped")),
    },
  });
}
