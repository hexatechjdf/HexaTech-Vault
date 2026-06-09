// drive-verify — super_admin only.
// Confirms the stored Drive credentials still work by making a real call to
// Drive's /about endpoint. Returns the connected account email + whether the
// root folder is still reachable. Used by the Settings → Google Drive UI's
// "Verify connection" button.
//
// Failure modes we explicitly distinguish:
//   - not_connected   : no drive_connection row yet
//   - token_revoked   : refresh failed (Google says the refresh token is invalid)
//   - root_missing    : the cached root_folder_id no longer exists on Drive
//   - drive_error     : Drive API returned a non-2xx for another reason
//   - ok              : everything resolved
//
// Side effect on success: writes a `drive.verify` audit row.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, requireSuperAdmin, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { getAccessToken, about, getFile } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    requireSuperAdmin(user);

    const svc = serviceClient();
    const { data: conn } = await svc
      .from("drive_connection")
      .select("google_account_email, root_folder_id, root_folder_name")
      .eq("id", true)
      .maybeSingle();

    if (!conn) {
      return jsonResponse({ ok: false, reason: "not_connected" });
    }

    // 1) Refresh / fetch a current access token. Failure here usually means
    //    the refresh token was revoked (test users / consent withdrawn).
    let accessToken: string;
    try {
      accessToken = await getAccessToken();
    } catch (e) {
      await writeAudit({
        actorId: user.id,
        action: "drive.verify",
        resourceType: "connection",
        result: "failure",
        details: { reason: "token_revoked", message: String((e as Error).message ?? e) },
        ipAddress: clientIp(req),
      });
      return jsonResponse({ ok: false, reason: "token_revoked" });
    }

    // 2) Ping Drive's /about — confirms the token is accepted.
    let accountEmail: string | null = null;
    try {
      const info = await about(accessToken);
      accountEmail = info.user?.emailAddress ?? null;
    } catch (e) {
      await writeAudit({
        actorId: user.id,
        action: "drive.verify",
        resourceType: "connection",
        result: "failure",
        details: { reason: "drive_error", message: String((e as Error).message ?? e) },
        ipAddress: clientIp(req),
      });
      return jsonResponse({ ok: false, reason: "drive_error" });
    }

    // 3) Confirm the cached root folder is still reachable.
    let rootReachable = true;
    if (conn.root_folder_id) {
      try {
        await getFile(accessToken, conn.root_folder_id);
      } catch {
        rootReachable = false;
      }
    }

    await writeAudit({
      actorId: user.id,
      action: "drive.verify",
      resourceType: "connection",
      result: rootReachable ? "success" : "failure",
      details: {
        accountEmail,
        rootFolderName: conn.root_folder_name,
        rootReachable,
      },
      ipAddress: clientIp(req),
    });

    if (!rootReachable) {
      return jsonResponse({
        ok: false,
        reason: "root_missing",
        accountEmail,
        rootFolderName: conn.root_folder_name,
      });
    }

    return jsonResponse({
      ok: true,
      accountEmail,
      rootFolderName: conn.root_folder_name,
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("drive-verify error:", e);
    return errorResponse("Internal error", 500);
  }
});
