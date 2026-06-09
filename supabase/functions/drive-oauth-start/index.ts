// drive-oauth-start (item 01) — super_admin only.
// Returns a Google OAuth consent URL. The frontend redirects the browser to
// the returned `url`. This is invoked for both the FIRST connect AND for any
// re-connect (swap Google account / refresh consent after token revocation),
// so we no longer 409 when a connection already exists.
//
// auth -> permission(super_admin) -> action -> audit

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, requireSuperAdmin, HttpError } from "../_shared/auth.ts";
import { requireEnv } from "../_shared/supabase.ts";
import { signState } from "../_shared/crypto.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    requireSuperAdmin(user);

    // Signed, single-use, time-boxed state tied to this super_admin.
    const state = await signState(user.id);

    const params = new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      redirect_uri: requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
      response_type: "code",
      scope: `${DRIVE_SCOPE} ${EMAIL_SCOPE}`,
      access_type: "offline", // ask for a refresh token
      prompt: "consent", // force consent so a refresh token is always returned
      include_granted_scopes: "true",
      state,
    });
    const url = `${GOOGLE_AUTH}?${params}`;

    await writeAudit({
      actorId: user.id,
      action: "drive.connect.start",
      resourceType: "connection",
      details: { initiated: true },
      ipAddress: clientIp(req),
    });

    return jsonResponse({ url });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-oauth-start error:", e);
    return errorResponse("Internal error", 500);
  }
});
