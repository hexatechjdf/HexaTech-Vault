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
import type { Role } from "@/lib/types";

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

// GET /api/admin/users — list every app_user with their department name.
// Any active authenticated user can read; RLS confirms no one outside the
// app_users table can.
export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  const { data, error } = await supabase
    .from("app_users")
    .select("id, name, email, google_email, role, department_id, avatar, status, departments(name)")
    .order("name", { ascending: true });
  if (error) return bad("Failed to load users", 500);

  const users = (data ?? []).map((u) => {
    const dept = Array.isArray(u.departments) ? u.departments[0] : u.departments;
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
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

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
