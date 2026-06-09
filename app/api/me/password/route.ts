// POST /api/me/password
//
// The signed-in user changes their own password.
//
// Body: { currentPassword, newPassword }
// Flow: cookie-auth -> verify currentPassword via a fresh signInWithPassword
//       (no session mutation visible to the user) -> updateUserById with new
//       password (admin client) -> audit. Never logs passwords; never returns
//       them.
//
// We use the admin client to apply the new password so the user's existing
// session keeps working — no need to make them log in again.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";
import { getClientIp } from "@/lib/server/client-ip";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface Body {
  currentPassword: string;
  newPassword: string;
}

export async function POST(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, email, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  let body: Partial<Body>;
  try {
    body = (await req.json()) as Partial<Body>;
  } catch {
    return bad("Invalid JSON body");
  }

  const currentPassword = String(body.currentPassword ?? "");
  const newPassword = String(body.newPassword ?? "");

  if (!currentPassword) return bad("Current password is required", 422);
  if (newPassword.length < 8) return bad("New password must be at least 8 characters", 422);
  if (newPassword === currentPassword) {
    return bad("New password must differ from your current password", 422);
  }

  // 1) Verify the current password with a throwaway client. Doing this on a
  //    cookie-less client means the verification doesn't touch the user's
  //    real session at all.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return bad("Supabase env not configured", 500);
  }
  const verifier = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: verifyErr } = await verifier.auth.signInWithPassword({
    email: caller.email,
    password: currentPassword,
  });
  if (verifyErr) {
    return bad("Current password is incorrect", 401);
  }

  // 2) Update the password via the admin client (bypasses RLS, doesn't touch
  //    the user's session).
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const { error: updateErr } = await admin.auth.admin.updateUserById(caller.id, {
    password: newPassword,
  });
  if (updateErr) return bad(updateErr.message || "Failed to update password", 500);

  // 3) Audit. Don't include the password.
  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "self.password_change",
    resource_type: "user",
    resource_id: caller.id,
    details: { },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  return NextResponse.json({ ok: true });
}
