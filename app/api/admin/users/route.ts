// POST /api/admin/users — Super-admin provisioning of new users.
//
// Behaviour: super admin sets the initial password; the new auth.users row
// is created with `email_confirm: true` so the user can sign in immediately
// with that password. They can change it from Settings later. Sharing the
// password is out-of-band (Slack/in-person).
//
// Flow:  cookie session -> verify caller is active super_admin
//        -> validate body
//        -> verify department exists
//        -> service-role: createUser({ email, password, email_confirm: true })
//        -> insert matching app_users row
//        -> roll back the auth user if the profile insert fails
//        -> audit log
//        -> return sanitized user (never a token, never the password back).
//
// Email invite mode was removed; see CLAUDE.md for the follow-up that would
// reintroduce it (it requires /auth/callback + /auth/set-password).
//
// Required env: SUPABASE_SERVICE_ROLE_KEY (server-only). See next-app/.claude/rules/api.md
// for the auth-check pattern.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";
import { resolveTabLevel } from "@/lib/server/require-tab-level";
import type { Role } from "@/lib/types";

export const dynamic = 'force-dynamic';

const VALID_ROLES: Role[] = ["super_admin", "admin", "manager", "team_lead", "lead_dev", "team_member"];

interface CreateBody {
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  password: string;
  avatar?: string;
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// GET /api/admin/users — list every app_user with their department name AND
// the full set of grants (folder + tab) that effectively apply to them, split
// into three buckets (direct / role+dept / role-unscoped) so the User
// Management UI can show "what does this user have" without an N+1 of per-user
// effective-access calls.
//
// Auth: any active authenticated user. The user list is shared across screens
// (User Management, Folder Access Control, Tab Access Control, Audit Logs,
// Storage Overview), and gating it on `user_management:view` broke the Users
// tab inside Folder Access Control for callers who had `folder_access:action`
// but no user_management grant. The fine-grained "can this caller act on
// users" decision lives on the mutation routes, not on the listing.
//
// Implementation: instead of one effective-access query per user, we do TWO
// batched SELECTs (one for folder grants, one for tab grants) and bucket the
// results in memory. This stays O(grants) regardless of the user count.
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

  // Service-role client so the per-user grant join sees everything regardless
  // of RLS. The caller has already been gated above.
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const { data, error } = await admin
    .from("app_users")
    .select("id, name, email, google_email, role, department_id, avatar, status, departments:department_id(name)")
    .order("name", { ascending: true });
  if (error) return bad("Failed to load users", 500);

  const rawUsers = (data ?? []) as Array<{
    id: string;
    name: string;
    email: string;
    google_email: string | null;
    role: string;
    department_id: string | null;
    avatar: string | null;
    status: string | null;
    departments: { name?: string } | { name?: string }[] | null;
  }>;

  // Collect the principal handles we need to fetch grants for. Users grants
  // key on user.id; role grants key on (role, department_id) for the
  // role+dept bucket and on role alone for the unscoped bucket.
  const userIds = rawUsers.map((u) => u.id);
  const roles = Array.from(new Set(rawUsers.map((u) => u.role)));

  type FolderGrantRow = {
    id: string;
    folder_id: string;
    principal_type: "user" | "role";
    principal_id: string;
    principal_dept_id: string | null;
    level: string;
    expires_at: string | null;
    folders: { name: string | null; path: string | null } | { name: string | null; path: string | null }[] | null;
    departments: { name: string | null } | { name: string | null }[] | null;
  };

  type TabGrantRow = {
    id: string;
    tab: string;
    principal_type: "user" | "role";
    principal_id: string;
    principal_dept_id: string | null;
    level: string;
    departments: { name: string | null } | { name: string | null }[] | null;
  };

  const nowIso = new Date().toISOString();

  // Two batched fetches. Filter ONLY on expiry server-side — chaining a second
  // `.or()` for principal scoping triggered PostgREST corner-cases where the
  // nested `in.(uuid,uuid)` got mis-tokenized and the API quietly returned an
  // empty set, which is why the table chips read "0 · 0" even when grants
  // existed. Bucketing per-user happens in memory; the grants tables are
  // bounded by the size of the admin surface (hundreds of rows at most), so
  // the extra rows we pull are a non-issue.
  // We DO filter principal_type so we never pull grants for principal types
  // the engine ignores.
  const roleSet = new Set(roles);

  const [foldersRes, tabsRes] = await Promise.all([
    admin
      .from("permission_grants")
      .select(
        "id, folder_id, principal_type, principal_id, principal_dept_id, level, expires_at, folders:folder_id(name, path), departments:principal_dept_id(name)",
      )
      .in("principal_type", ["user", "role"])
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    admin
      .from("tab_permission_grants")
      .select(
        "id, tab, principal_type, principal_id, principal_dept_id, level, departments:principal_dept_id(name)",
      )
      .in("principal_type", ["user", "role"]),
  ]);

  if (foldersRes.error) return bad(foldersRes.error.message, 500);
  if (tabsRes.error) return bad(tabsRes.error.message, 500);

  // Normalise principal_id comparison to lowercase. UUIDs stored in PG are
  // canonical-lowercase, but principal_id is `text` so any code path that
  // wrote them with different casing won't match the lookup user.id. We
  // build a lowercased set + compare on lowercased grant id.
  const userIdSet = new Set(userIds.map((s) => s.toLowerCase()));

  function principalUserMatches(g: FolderGrantRow | TabGrantRow, userIdLc: string) {
    return g.principal_type === "user" && (g.principal_id ?? "").toLowerCase() === userIdLc;
  }
  function principalRoleMatches(g: FolderGrantRow | TabGrantRow, role: string, deptId: string | null, scope: "dept" | "unscoped") {
    if (g.principal_type !== "role" || g.principal_id !== role) return false;
    if (scope === "dept") return deptId !== null && g.principal_dept_id === deptId;
    return g.principal_dept_id === null;
  }

  // Drop grants that can't apply to anyone in our user listing. Reduces the
  // memory we walk in the per-user filter below.
  const folderGrants = ((foldersRes.data ?? []) as FolderGrantRow[]).filter((g) =>
    g.principal_type === "user"
      ? userIdSet.has((g.principal_id ?? "").toLowerCase())
      : roleSet.has(g.principal_id),
  );
  const tabGrants = ((tabsRes.data ?? []) as TabGrantRow[]).filter((g) =>
    g.principal_type === "user"
      ? userIdSet.has((g.principal_id ?? "").toLowerCase())
      : roleSet.has(g.principal_id),
  );

  // Lookup helpers — pull the first matching row from a Supabase embed which
  // is sometimes object, sometimes array depending on the join cardinality.
  function pickOne<T>(v: T | T[] | null | undefined): T | null {
    if (!v) return null;
    return Array.isArray(v) ? (v[0] ?? null) : v;
  }

  function shapeFolderGrant(row: FolderGrantRow, source: "direct" | "role_dept" | "role_unscoped", role: string) {
    const folder = pickOne(row.folders);
    const dept = pickOne(row.departments);
    return {
      id: row.id,
      folderId: row.folder_id,
      folderName: folder?.name ?? "—",
      folderPath: folder?.path ?? "",
      level: row.level,
      source,
      via:
        source === "role_dept" ? `${role} · ${dept?.name ?? "—"}`
        : source === "role_unscoped" ? `${role} · All departments`
        : "Direct user grant",
    };
  }

  function shapeTabGrant(row: TabGrantRow, source: "direct" | "role_dept" | "role_unscoped", role: string) {
    const dept = pickOne(row.departments);
    return {
      id: row.id,
      tab: row.tab,
      level: row.level,
      source,
      via:
        source === "role_dept" ? `${role} · ${dept?.name ?? "—"}`
        : source === "role_unscoped" ? `${role} · All departments`
        : "Direct user grant",
    };
  }

  const users = rawUsers.map((u) => {
    const dept = pickOne(u.departments);
    const role = u.role;
    const deptId = u.department_id;
    const uIdLc = u.id.toLowerCase();

    // Direct user grants always belong to this user.
    const directFolders = folderGrants
      .filter((g) => principalUserMatches(g, uIdLc))
      .map((g) => shapeFolderGrant(g, "direct", role));

    // Role + caller's department.
    const roleDeptFolders = deptId
      ? folderGrants
          .filter((g) => principalRoleMatches(g, role, deptId, "dept"))
          .map((g) => shapeFolderGrant(g, "role_dept", role))
      : [];

    // Role-unscoped (applies to every user with this role).
    const roleUnscopedFolders = folderGrants
      .filter((g) => principalRoleMatches(g, role, deptId, "unscoped"))
      .map((g) => shapeFolderGrant(g, "role_unscoped", role));

    const directTabs = tabGrants
      .filter((g) => principalUserMatches(g, uIdLc))
      .map((g) => shapeTabGrant(g, "direct", role));

    const roleDeptTabs = deptId
      ? tabGrants
          .filter((g) => principalRoleMatches(g, role, deptId, "dept"))
          .map((g) => shapeTabGrant(g, "role_dept", role))
      : [];

    const roleUnscopedTabs = tabGrants
      .filter((g) => principalRoleMatches(g, role, deptId, "unscoped"))
      .map((g) => shapeTabGrant(g, "role_unscoped", role));

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      googleEmail: u.google_email,
      role: u.role,
      departmentId: u.department_id ?? "",
      departmentName: (dept as { name?: string } | null)?.name ?? "",
      avatar: u.avatar ?? (u.name ?? "").slice(0, 2).toUpperCase(),
      status: u.status,
      permissions: {
        folders: {
          direct: directFolders,
          inheritedRoleDept: roleDeptFolders,
          inheritedRoleUnscoped: roleUnscopedFolders,
        },
        tabs: {
          direct: directTabs,
          inheritedRoleDept: roleDeptTabs,
          inheritedRoleUnscoped: roleUnscopedTabs,
        },
      },
    };
  });

  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  // 1) Identify the caller via the cookie session.
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  // 2) Authorize: must be active super_admin.
  const { data: caller, error: callerErr } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (callerErr) return bad("Failed to load caller profile", 500);
  if (!caller) return bad("No profile for caller", 403);
  if (caller.status !== "active") return bad("Account inactive", 403);
  // Allow super admins (fast path) OR non-super-admins with an explicit
  // user_management:action grant via the tab permission system. The tab
  // engine bypass-RLS-resolves the caller's effective level. Anything below
  // 'action' is rejected here so the client cannot lie about its UI gate.
  if (caller.role !== "super_admin") {
    const level = await resolveTabLevel(caller.id, "user_management");
    if (level !== "action") return bad("Insufficient permission on User Management", 403);
  }

  // 3) Parse + validate the body.
  let body: Partial<CreateBody>;
  try {
    body = (await req.json()) as Partial<CreateBody>;
  } catch {
    return bad("Invalid JSON body");
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "") as Role;
  const departmentId = String(body.departmentId ?? "").trim();
  const avatar = String(body.avatar ?? name.slice(0, 2).toUpperCase());
  const password = String(body.password ?? "");

  // Super Admin and Admin do not belong to a department. For every other role
  // a department is required (FK in app_users would also reject, but this gives
  // a clean 422 instead of a 500).
  const requiresDepartment = role !== "super_admin" && role !== "admin";

  if (!name) return bad("Name is required", 422);
  if (!email || !email.includes("@")) return bad("Valid email is required", 422);
  if (!VALID_ROLES.includes(role)) return bad("Invalid role", 422);
  if (requiresDepartment && !departmentId) return bad("Department is required", 422);
  if (password.length < 8) return bad("Password must be at least 8 characters", 422);

  // 4) Verify department exists when one was supplied.
  let dept: { id: string; name: string } | null = null;
  if (departmentId) {
    const { data: found } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", departmentId)
      .maybeSingle();
    if (!found) return bad("Department not found", 422);
    dept = found;
  }

  // 5) Create the auth user via service role.
  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  let createdAuthId: string;
  try {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    createdAuthId = data.user.id;
  } catch (e) {
    const msg = ((e as { message?: string })?.message ?? "Failed to create auth user").toLowerCase();
    if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("duplicate")) {
      return bad("A user with that email already exists", 409);
    }
    return bad((e as { message?: string })?.message ?? "Failed to create auth user", 500);
  }

  // 6) Insert the matching app_users profile row.
  const { error: insertErr } = await admin.from("app_users").insert({
    id: createdAuthId,
    name,
    email,
    role,
    department_id: departmentId || null,
    avatar,
    status: "active",
  });

  if (insertErr) {
    // Roll back the auth user so we don't leave an orphan auth account.
    try {
      await admin.auth.admin.deleteUser(createdAuthId);
    } catch {
      /* best-effort rollback */
    }
    return bad(insertErr.message || "Failed to create profile", 500);
  }

  // 7) Audit log (after success).
  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "admin.user_create",
    resource_type: "user",
    resource_id: createdAuthId,
    details: { email, role, department_id: departmentId || null },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  // 8) Sanitized response. Never returns password or any token.
  return NextResponse.json(
    {
      ok: true,
      user: {
        id: createdAuthId,
        name,
        email,
        role,
        departmentId: departmentId || null,
        departmentName: dept?.name ?? "",
        avatar,
        status: "active",
      },
    },
    { status: 201 },
  );
}
