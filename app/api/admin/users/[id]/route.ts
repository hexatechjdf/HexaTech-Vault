// PATCH /api/admin/users/[id] — Super-admin updates to an existing user.
// DELETE /api/admin/users/[id] — Super-admin deletes a user.
//
// PATCH uses an `action` discriminator on the body to keep the surface small
// while keeping each branch auditable on its own:
//   - "update_profile" → { name?, avatar?, googleEmail? }
//   - "update_role"    → { role, departmentId }
//   - "update_status"  → { status: "active" | "inactive" }
//   - "reset_password" → { password }  (admin-set; shared with user out-of-band)
//
// Guard rails enforced server-side (not just UI):
//   - Caller must be an active super_admin.
//   - Caller cannot deactivate / delete / demote themselves.
//   - Deleting / deactivating / demoting the last super_admin is rejected.
//   - When changing role: super_admin / admin must have null department_id;
//     every other role must have a real department id.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";
import { resolveTabLevel } from "@/lib/server/require-tab-level";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID_ROLES: Role[] = ["super_admin", "admin", "manager", "team_lead", "lead_dev", "team_member"];

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface RouteCtx { params: { id: string } }

// Gates mutations on the user_management tab engine. Super admins always pass.
// Everyone else needs an explicit `user_management:action` grant. We also
// keep caller.role around because a few sub-actions (promoting someone to
// super_admin, OR touching an existing super_admin) are escalations that
// stay super-admin-only regardless of tab grant.
async function authorizeForUserMgmt() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return { error: bad("Not signed in", 401) } as const;

  const { data: caller, error: callerErr } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (callerErr) return { error: bad("Failed to load caller profile", 500) } as const;
  if (!caller) return { error: bad("No profile for caller", 403) } as const;
  if (caller.status !== "active") return { error: bad("Account inactive", 403) } as const;

  if (caller.role !== "super_admin") {
    const level = await resolveTabLevel(authUser.id, "user_management");
    if (level !== "action") return { error: bad("Insufficient permission on User Management", 403) } as const;
  }

  return { caller: { id: caller.id, role: caller.role as Role }, supabase } as const;
}

async function loadTarget(admin: ReturnType<typeof createSupabaseAdminClient>, id: string) {
  const { data, error } = await admin
    .from("app_users")
    .select("id, name, email, role, department_id, avatar, status, google_email")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: bad("Failed to load target user", 500) } as const;
  if (!data) return { error: bad("User not found", 404) } as const;
  return { target: data } as const;
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const auth = await authorizeForUserMgmt();
  if ("error" in auth) return auth.error;
  const { caller } = auth;

  const targetId = String(ctx.params.id ?? "").trim();
  if (!targetId) return bad("Missing user id", 422);

  let body: { action?: string } & Record<string, unknown>;
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return bad("Invalid JSON body");
  }

  const action = String(body.action ?? "").trim();
  const ip = getClientIp(req.headers);

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const targetRes = await loadTarget(admin, targetId);
  if ("error" in targetRes) return targetRes.error;
  const { target } = targetRes;

  // System-level guard: any operation that touches an EXISTING super_admin
  // (edit / demote / deactivate / reset password) stays super-admin-only,
  // even for callers who hold user_management:action. Super admin is the
  // system root and the tab engine should not be able to grant escalation
  // into it. Promoting someone TO super_admin is handled in update_role.
  if (target.role === "super_admin" && caller.role !== "super_admin") {
    return bad("Only super admins can modify a super admin", 403);
  }

  if (action === "update_profile") {
    const name = body.name === undefined ? undefined : String(body.name).trim();
    const avatar = body.avatar === undefined ? undefined : String(body.avatar).trim();
    const googleEmailRaw = body.googleEmail === undefined ? undefined : String(body.googleEmail).trim().toLowerCase();

    if (name !== undefined && !name) return bad("Name cannot be empty", 422);
    if (googleEmailRaw && !googleEmailRaw.includes("@")) return bad("Invalid Google email", 422);

    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (avatar !== undefined) patch.avatar = avatar || target.avatar;
    if (googleEmailRaw !== undefined) patch.google_email = googleEmailRaw || null;
    if (Object.keys(patch).length === 0) return bad("Nothing to update", 422);

    const { error } = await admin.from("app_users").update(patch).eq("id", targetId);
    if (error) return bad(error.message || "Failed to update profile", 500);

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "admin.user_update",
      resource_type: "user",
      resource_id: targetId,
      details: { email: target.email, changes: Object.keys(patch) },
      result: "success",
      ip_address: ip,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_role") {
    const role = String(body.role ?? "") as Role;
    const departmentId = String(body.departmentId ?? "").trim();
    if (!VALID_ROLES.includes(role)) return bad("Invalid role", 422);

    // System-level guard: promoting to super_admin stays super-admin-only.
    // user_management:action does NOT confer the ability to create new
    // super admins — that's a system root operation.
    if (role === "super_admin" && caller.role !== "super_admin") {
      return bad("Only super admins can promote users to super admin", 403);
    }

    const requiresDept = role !== "super_admin" && role !== "admin";
    if (requiresDept && !departmentId) return bad("Department is required for this role", 422);

    if (caller.id === targetId && role !== "super_admin") {
      return bad("You cannot change your own role", 403);
    }

    if (target.role === "super_admin" && role !== "super_admin") {
      const { count } = await admin
        .from("app_users")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")
        .eq("status", "active");
      if ((count ?? 0) <= 1) return bad("Cannot demote the last active super admin", 409);
    }

    if (requiresDept) {
      const { data: dept } = await admin
        .from("departments").select("id").eq("id", departmentId).maybeSingle();
      if (!dept) return bad("Department not found", 422);
    }

    const { error } = await admin
      .from("app_users")
      .update({ role, department_id: requiresDept ? departmentId : null })
      .eq("id", targetId);
    if (error) return bad(error.message || "Failed to update role", 500);

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "admin.user_role_change",
      resource_type: "user",
      resource_id: targetId,
      details: {
        email: target.email,
        from: { role: target.role, department_id: target.department_id },
        to: { role, department_id: requiresDept ? departmentId : null },
      },
      result: "success",
      ip_address: ip,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "update_status") {
    const status = String(body.status ?? "");
    if (status !== "active" && status !== "inactive") return bad("Invalid status", 422);

    if (caller.id === targetId && status === "inactive") {
      return bad("You cannot deactivate yourself", 403);
    }

    if (status === "inactive" && target.role === "super_admin") {
      const { count } = await admin
        .from("app_users")
        .select("id", { count: "exact", head: true })
        .eq("role", "super_admin")
        .eq("status", "active");
      if ((count ?? 0) <= 1) return bad("Cannot deactivate the last active super admin", 409);
    }

    const { error } = await admin.from("app_users").update({ status }).eq("id", targetId);
    if (error) return bad(error.message || "Failed to update status", 500);

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: status === "active" ? "admin.user_activate" : "admin.user_deactivate",
      resource_type: "user",
      resource_id: targetId,
      details: { email: target.email, from: target.status, to: status },
      result: "success",
      ip_address: ip,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "reset_password") {
    const password = String(body.password ?? "");
    if (password.length < 8) return bad("Password must be at least 8 characters", 422);

    const { error } = await admin.auth.admin.updateUserById(targetId, { password });
    if (error) return bad(error.message || "Failed to reset password", 500);

    await admin.from("audit_log").insert({
      actor_id: caller.id,
      action: "admin.user_password_reset",
      resource_type: "user",
      resource_id: targetId,
      details: { email: target.email, mode: "admin_set" },
      result: "success",
      ip_address: ip,
    });
    return NextResponse.json({ ok: true });
  }

  return bad("Unknown action", 422);
}

export async function DELETE(req: Request, ctx: RouteCtx) {
  const auth = await authorizeForUserMgmt();
  if ("error" in auth) return auth.error;
  const { caller } = auth;

  const targetId = String(ctx.params.id ?? "").trim();
  if (!targetId) return bad("Missing user id", 422);
  if (caller.id === targetId) return bad("You cannot delete yourself", 403);

  let admin;
  try {
    admin = createSupabaseAdminClient();
  } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const targetRes = await loadTarget(admin, targetId);
  if ("error" in targetRes) return targetRes.error;
  const { target } = targetRes;

  // System-level guard: deleting a super_admin stays super-admin-only.
  if (target.role === "super_admin" && caller.role !== "super_admin") {
    return bad("Only super admins can delete a super admin", 403);
  }

  if (target.role === "super_admin") {
    const { count } = await admin
      .from("app_users")
      .select("id", { count: "exact", head: true })
      .eq("role", "super_admin")
      .eq("status", "active");
    if ((count ?? 0) <= 1) return bad("Cannot delete the last active super admin", 409);
  }

  // Sweep dead per-user grants first. principal_id is text (not a real FK),
  // so leaving them wouldn't block the delete — but they'd dangle pointing at
  // a deleted user. We delete grants where principal_type='user' AND
  // principal_id matches the target. Best-effort: if either fails we still
  // proceed with the auth delete, because every other "who did this" FK is
  // covered by migration 0028's ON DELETE SET NULL.
  await admin
    .from("permission_grants")
    .delete()
    .eq("principal_type", "user")
    .eq("principal_id", targetId);
  await admin
    .from("tab_permission_grants")
    .delete()
    .eq("principal_type", "user")
    .eq("principal_id", targetId);

  // Deleting the auth user cascades to app_users via ON DELETE CASCADE
  // (see 0001_schema.sql: app_users.id references auth.users(id) on delete cascade).
  // Every "who did this" FK on app_users(id) is ON DELETE SET NULL after
  // migration 0028, so audit/history rows survive with actor_id=null.
  const { error } = await admin.auth.admin.deleteUser(targetId);
  if (error) return bad(error.message || "Failed to delete user", 500);

  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "admin.user_delete",
    resource_type: "user",
    resource_id: targetId,
    details: { email: target.email, role: target.role },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
