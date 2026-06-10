"use server";

// Reset-password server action — the second half of the forgot-password flow.
//
// Inputs:
//   code        — PKCE auth code Supabase appended to the email link
//                 (?code=...). Required.
//   newPassword — what the user typed in the "new password" form.
//
// Flow:
//   1. Validate the new password (length, confirmation matched client-side).
//   2. Exchange the magic-link code for a session via @supabase/ssr's
//      cookie-backed client. This authenticates the caller as the email
//      recipient — but only for this request.
//   3. updateUser({ password }) — Supabase Auth replaces the password hash.
//   4. signOut() — clears the session cookies so the user must log back in
//      with the new password (matches every other "reset complete" UX I've
//      seen and prevents accidental "I'm now logged in as the password I
//      just forgot" confusion).
//   5. Audit-log the success (or failure with the Supabase error).
//
// Returns a { error } object for the page to surface inline. The page also
// reads the success path and redirects on its own — we deliberately do NOT
// `redirect()` from inside the action so the client can show a brief
// confirmation toast before navigating.

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";
import { headers } from "next/headers";

export interface ResetPasswordResult {
  error?: string;
  /** True when the password was updated. Caller redirects to /login. */
  ok?: boolean;
}

export async function resetPasswordAction(
  code: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  // 1) Validate inputs.
  if (!code) return { error: "This reset link is missing its token. Please request a new email." };
  if (newPassword.length < 8) return { error: "Password must be at least 8 characters." };

  const supabase = createSupabaseServerClient();
  const admin = createSupabaseAdminClient();
  const ipAddress = getClientIp(headers());

  // 2) Exchange the PKCE code for a session. This call sets the auth cookies
  //    via the server client's cookie jar.
  const { data: exchanged, error: exchangeErr } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeErr || !exchanged.session) {
    // The link is expired, was already used, or is malformed. Audit with no
    // actor_id since we couldn't resolve the user.
    await admin.from("audit_log").insert({
      actor_id: null,
      action: "self.password_reset_complete",
      resource_type: "auth",
      details: { outcome: "exchange_failed", error: exchangeErr?.message ?? "no session returned" },
      result: "failure",
      ip_address: ipAddress,
    });
    return {
      error:
        "This reset link is invalid or has expired. Please request a new one from the login page.",
    };
  }

  const authId = exchanged.session.user.id;

  // 3) Set the new password.
  const { error: updErr } = await supabase.auth.updateUser({ password: newPassword });
  if (updErr) {
    await admin.from("audit_log").insert({
      actor_id: authId,
      action: "self.password_reset_complete",
      resource_type: "auth",
      details: { outcome: "update_failed", error: updErr.message },
      result: "failure",
      ip_address: ipAddress,
    });
    // Common case: Supabase rejects a password that matches the previous one
    // when "Same password rejection" is enabled in project settings.
    return { error: updErr.message ?? "Could not update password. Please try again." };
  }

  // 4) Clear the cookies so the user has to actively sign in with the new
  //    password. signOut writes to the cookie jar on the server client.
  await supabase.auth.signOut();

  // Also clear the per-email cooldown — the reset is done; if they ever need
  // another one, they shouldn't have to wait.
  await admin
    .from("app_users")
    .update({ password_reset_requested_at: null })
    .eq("id", authId);

  await admin.from("audit_log").insert({
    actor_id: authId,
    action: "self.password_reset_complete",
    resource_type: "auth",
    details: { outcome: "password_updated" },
    result: "success",
    ip_address: ipAddress,
  });

  return { ok: true };
}
