// shared-with-me ({}) -> { folders: FolderDTO[] } (item 06).
// Returns every folder where the caller has effective access via any applicable
// principal: assignee row, direct user grant, ROLE grant (matching app_users.role),
// or DEPARTMENT grant (matching app_users.department_id). This is the "My folders"
// entry point for non-super-admin users (who can't see the company root): it
// surfaces the specific folders they've been given access to, regardless of how.
//
// Important: role-only / department-only access must surface here, otherwise
// users like Team Members or Lead Devs whose access came through a role or
// department grant (the most common case) would see an EMPTY list and have no
// way to reach their files. getEffectiveLevel below still gates the final
// response so revoked / expired access is filtered out.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { getEffectiveLevel } from "../_shared/permissions.ts";
import { toFolderDTO, FolderDTO, FolderRow } from "../_shared/dto.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const svc = serviceClient();

    // Look up the caller's role + department so we can include role-grants and
    // department-grants in the candidate set. Without this, users with only a
    // role or department grant (e.g. Team Member / Lead Dev who got access via
    // their role) would see an empty "My Folders" view.
    const { data: profile } = await svc
      .from("app_users")
      .select("role, department_id")
      .eq("id", user.id)
      .maybeSingle();

    // Collect candidate folder ids from every applicable principal in parallel.
    //
    // Role grants now come in two flavours (migration 0021):
    //   • principal_dept_id IS NULL  → applies to every user with this role
    //                                  ("all departments")
    //   • principal_dept_id = my dept → applies only to my role+dept
    //
    // We fetch both for the caller and merge. The unscoped query is gated by
    // the IS NULL filter so it doesn't pick up other-department scoped grants.
    const folderIds = new Set<string>();

    const [assignedRes, userGrantsRes, roleUnscopedRes, roleDeptRes, deptGrantsRes] = await Promise.all([
      svc
        .from("folder_assignees")
        .select("folder_id")
        .eq("user_id", user.id),
      svc
        .from("permission_grants")
        .select("folder_id")
        .eq("principal_type", "user")
        .eq("principal_id", user.id),
      // (A) role-unscoped grants for my role (principal_dept_id IS NULL).
      profile?.role
        ? svc
            .from("permission_grants")
            .select("folder_id")
            .eq("principal_type", "role")
            .eq("principal_id", profile.role)
            .is("principal_dept_id", null)
        : Promise.resolve({ data: [] as { folder_id: string }[] }),
      // (B) role+dept grants for my role AND my department.
      profile?.role && profile?.department_id
        ? svc
            .from("permission_grants")
            .select("folder_id")
            .eq("principal_type", "role")
            .eq("principal_id", profile.role)
            .eq("principal_dept_id", profile.department_id)
        : Promise.resolve({ data: [] as { folder_id: string }[] }),
      // Legacy department-principal grants (migration 0015 cleared the data
      // but keep the query so a future re-introduction stays compatible).
      profile?.department_id
        ? svc
            .from("permission_grants")
            .select("folder_id")
            .eq("principal_type", "department")
            .eq("principal_id", profile.department_id)
        : Promise.resolve({ data: [] as { folder_id: string }[] }),
    ]);

    for (const a of assignedRes.data ?? []) folderIds.add(a.folder_id);
    for (const g of userGrantsRes.data ?? []) folderIds.add(g.folder_id);
    for (const g of roleUnscopedRes.data ?? []) folderIds.add(g.folder_id);
    for (const g of roleDeptRes.data ?? []) folderIds.add(g.folder_id);
    for (const g of deptGrantsRes.data ?? []) folderIds.add(g.folder_id);

    if (folderIds.size === 0) return jsonResponse({ folders: [] });

    const { data: rows } = await svc
      .from("folders")
      .select(
        "id, drive_file_id, name, parent_id, is_root, owner_department_id, path, updated_at, departments:owner_department_id(name)",
      )
      .in("id", Array.from(folderIds))
      .is("deleted_at", null);

    // Compute item counts (direct, non-deleted children) for each listed folder
    // so the FileManager's "Size" column can render "N items" — same pattern as
    // drive-list. Two batched queries instead of N+1.
    const listedIds = (rows ?? []).map((r) => r.id);
    const counts = new Map<string, number>();
    if (listedIds.length > 0) {
      const [{ data: nestedFolders }, { data: nestedFiles }] = await Promise.all([
        svc
          .from("folders")
          .select("parent_id")
          .in("parent_id", listedIds)
          .is("deleted_at", null),
        svc
          .from("files")
          .select("folder_id")
          .in("folder_id", listedIds)
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
    for (const r of (rows ?? []) as unknown as FolderRow[]) {
      // Skip if effective access has been zeroed/removed.
      const level = await getEffectiveLevel(user.id, r.id);
      if (level === "no_access") continue;
      folders.push(await toFolderDTO(r, user.id, undefined, counts.get(r.id) ?? 0));
    }

    return jsonResponse({ folders });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("shared-with-me error:", e);
    return errorResponse("Internal error", 500);
  }
});
