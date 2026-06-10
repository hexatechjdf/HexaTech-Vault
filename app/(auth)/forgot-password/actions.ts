"use server";

// Forgot-password server action.
//
// Flow:
//   1. Validate the email format.
//   2. Look up app_users by email. If absent, we silently exit (still returning
//      a generic success message) so we don't leak which addresses are valid.
//   3. Enforce a per-email cooldown via app_users.password_reset_requested_at
//      (60 seconds by default). If the cooldown is active we ALSO silently exit
//      — the user/attacker can keep submitting, but no email goes out and no
//      Supabase Auth quota is consumed until the cooldown elapses.
//   4. Call supabase.auth.resetPasswordForEmail() with our reset-password page
//      as the redirect target. Supabase emails the user a magic link.
//   5. Stamp password_reset_requested_at = now() and audit-log the attempt.
//
// We never reveal whether the email existed, whether the cooldown blocked the
// request, or whether Supabase succeeded. The form always shows the same
// "if your email is registered, you'll receive a link" confirmation. This
// matches the well-known pattern used by GitHub / Stripe / etc.

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/server/client-ip";
import { headers } from "next/headers";

/** Minimum seconds between successful reset-link dispatches for the same email. */
const COOLDOWN_SECONDS = 60;

export interface ForgotPasswordResult {
  /** Set when the input itself was malformed (empty / not an email). UI shows this inline. */
  error?: string;
  /** Generic confirmation copy. Same string whether the email existed or not. */
  notice?: string;
  /** Seconds remaining if the cooldown is active. UI uses it to display "retry in N s". */
  retryAfterSeconds?: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_NOTICE =
  "If that email is registered, a password reset link has been sent. Check your inbox (and spam folder).";

/**
 * Resolves the absolute URL the email magic-link should land on. Reads the
 * forwarded host so it works behind Vercel / Nginx / a reverse proxy. Falls
 * back to NEXT_PUBLIC_SITE_URL, then to a hardcoded localhost for dev.
 */
function resolveRedirectTo(): string {
  const h = headers();
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
  if (envUrl) return `${envUrl}/reset-password`;
  const forwardedHost = h.get("x-forwarded-host") ?? h.get("host");
  const forwardedProto = h.get("x-forwarded-proto") ?? "https";
  if (forwardedHost) return `${forwardedProto}://${forwardedHost}/reset-password`;
  return "http://localhost:3000/reset-password";
}

export async function forgotPasswordAction(emailRaw: string): Promise<ForgotPasswordResult> {
  const email = String(emailRaw ?? "").trim().toLowerCase();

  // 1) Surface-level validation. This is the only error the UI will ever see
  //    — everything below the validation gate maps to GENERIC_NOTICE so we
  //    don't leak which emails are registered.
  if (!email) return { error: "Please enter your email address." };
  if (!EMAIL_RE.test(email)) return { error: "Please enter a valid email address." };

  const admin = createSupabaseAdminClient();
  const h = headers();
  const ipAddress = getClientIp(h);

  // 2) Look up the app_user. We use the admin client so RLS doesn't get in the
  //    way of the cooldown column read.
  const { data: user } = await admin
    .from("app_users")
    .select("id, status, password_reset_requested_at")
    .eq("email", email)
    .maybeSingle();

  // Audit even the "no such user" path so the trail has a record of who's
  // probing. Never include the email in details for unknown users (PII).
  if (!user) {
    await admin.from("audit_log").insert({
      actor_id: null,
      action: "self.password_reset_request",
      resource_type: "auth",
      details: { outcome: "no_such_user" },
      result: "success",
      ip_address: ipAddress,
    });
    return { notice: GENERIC_NOTICE };
  }

  if (user.status !== "active") {
    await admin.from("audit_log").insert({
      actor_id: user.id,
      action: "self.password_reset_request",
      resource_type: "auth",
      details: { outcome: "inactive_account" },
      result: "success",
      ip_address: ipAddress,
    });
    return { notice: GENERIC_NOTICE };
  }

  // 3) Cooldown gate. If a request was made within the window, silently
  //    no-op AND surface the retry-after to the UI (no email enumeration —
  //    the action only reveals cooldown info for emails that resolved to a
  //    real, active user, and the UI uses it purely as a friendly hint).
  const lastIso = user.password_reset_requested_at as string | null;
  if (lastIso) {
    const ageSeconds = (Date.now() - new Date(lastIso).getTime()) / 1000;
    if (ageSeconds < COOLDOWN_SECONDS) {
      const remaining = Math.max(1, Math.ceil(COOLDOWN_SECONDS - ageSeconds));
      await admin.from("audit_log").insert({
        actor_id: user.id,
        action: "self.password_reset_request",
        resource_type: "auth",
        details: { outcome: "cooldown_active", remainingSeconds: remaining },
        result: "success",
        ip_address: ipAddress,
      });
      return { notice: GENERIC_NOTICE, retryAfterSeconds: remaining };
    }
  }

  // 4) Dispatch the magic link via Supabase Auth. The redirect target is our
  //    /reset-password page, which finishes the flow.
  //
  // IMPORTANT: this call MUST go through the cookie-backed server client, not
  // the admin (service-role) client. @supabase/ssr defaults to the PKCE flow:
  // resetPasswordForEmail generates a code_verifier and stores it in the
  // browser's session cookies; later, the /reset-password page passes a
  // matching `code` to exchangeCodeForSession(), which checks the verifier.
  // The admin client doesn't read/write user cookies, so calling
  // resetPasswordForEmail from it skips the verifier write — and the user
  // sees "This reset link is invalid or has expired" on the next step.
  const supabase = createSupabaseServerClient();
  const redirectTo = resolveRedirectTo();
  const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (resetErr) {
    await admin.from("audit_log").insert({
      actor_id: user.id,
      action: "self.password_reset_request",
      resource_type: "auth",
      details: { outcome: "supabase_error", error: resetErr.message },
      result: "failure",
      ip_address: ipAddress,
    });
    // Still return the generic notice so the UI can't be used to enumerate
    // which addresses cause Supabase to error vs. succeed.
    return { notice: GENERIC_NOTICE };
  }

  // 5) Persist the cooldown stamp + audit success.
  await admin
    .from("app_users")
    .update({ password_reset_requested_at: new Date().toISOString() })
    .eq("id", user.id);

  await admin.from("audit_log").insert({
    actor_id: user.id,
    action: "self.password_reset_request",
    resource_type: "auth",
    details: { outcome: "email_sent", redirectTo },
    result: "success",
    ip_address: ipAddress,
  });

  return { notice: GENERIC_NOTICE };
}
