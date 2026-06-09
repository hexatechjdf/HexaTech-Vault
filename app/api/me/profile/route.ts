// /api/me/profile
//
// GET    -> returns the caller's own profile row (name, login email, google
//          email, role, department).
// PATCH  -> the caller updates their own editable fields:
//             - name        (optional)
//             - googleEmail (optional, can be null to clear)
//          Role / department / status are NOT editable here — only super_admin
//          can change those via /api/admin/users (future endpoint).
//
// Cookie-authed. Any active app_user can use these endpoints.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";

export const dynamic = 'force-dynamic';

// Loose email pattern — Drive will be the real gate. We just guard against
// obvious typos here.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface ProfileDTO {
  id: string;
  name: string;
  email: string;
  googleEmail: string | null;
  role: string;
  departmentId: string | null;
  departmentName: string;
  avatar: string;
  status: string;
}

async function loadProfile(supabase: ReturnType<typeof createSupabaseServerClient>, userId: string): Promise<ProfileDTO | null> {
  const { data } = await supabase
    .from("app_users")
    .select("id, name, email, google_email, role, department_id, avatar, status, departments(name)")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const dept = Array.isArray(data.departments) ? data.departments[0] : data.departments;
  return {
    id: data.id,
    name: data.name,
    email: data.email,
    googleEmail: (data.google_email as string | null) ?? null,
    role: data.role,
    departmentId: data.department_id ?? null,
    departmentName: (dept as { name?: string } | null)?.name ?? "",
    avatar: data.avatar ?? (data.name ?? "").slice(0, 2).toUpperCase(),
    status: data.status,
  };
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const profile = await loadProfile(supabase, authUser.id);
  if (!profile) return bad("Profile not found", 404);
  if (profile.status !== "active") return bad("Account inactive", 403);

  return NextResponse.json({ profile });
}

interface PatchBody {
  name?: string;
  googleEmail?: string | null;
}

export async function PATCH(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const updates: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) return bad("Name cannot be empty", 422);
    if (name.length > 120) return bad("Name too long", 422);
    updates.name = name;
  }

  if (body.googleEmail !== undefined) {
    if (body.googleEmail === null || body.googleEmail === "") {
      updates.google_email = null;
    } else {
      const ge = String(body.googleEmail).trim().toLowerCase();
      if (!EMAIL.test(ge)) return bad("Google email must look like an email address", 422);
      updates.google_email = ge;
    }
  }

  if (Object.keys(updates).length === 0) return bad("No updates provided", 422);

  // Use admin client so RLS doesn't fight self-updates (we've already verified
  // the caller is updating their own row by anchoring on auth.uid()).
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const { error: updErr } = await admin
    .from("app_users")
    .update(updates)
    .eq("id", caller.id);
  if (updErr) return bad(updErr.message || "Failed to update profile", 500);

  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "self.profile_update",
    resource_type: "user",
    resource_id: caller.id,
    details: { fields: Object.keys(updates) },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  const fresh = await loadProfile(supabase, caller.id);
  return NextResponse.json({ profile: fresh });
}
