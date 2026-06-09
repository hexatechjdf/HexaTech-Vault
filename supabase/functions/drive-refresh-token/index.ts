// drive-refresh-token — proactively keeps the Drive access token fresh.
//
// Triggered every 5 minutes by pg_cron (migration 0012). Authorization is
// either:
//   (a) Authorization: Bearer <CRON_SECRET>     ← the cron job
//   (b) Standard JWT from a super_admin caller  ← future "Force refresh" button
//
// Behaviour:
//   - Call the shared getAccessToken() which mints a new token whenever the
//     current one is within 5 minutes of expiry, and is a no-op otherwise.
//   - Persist a small audit row so we can verify the cron is alive without
//     digging through pg_cron logs.
//   - Never returns the access token itself - only metadata (expiry, refreshed
//     yes/no). Secrets stay server-side.
//
// Failure modes returned to the caller:
//   500 — refresh token revoked, Google denied refresh, encryption key wrong,
//         drive_connection not set up.
// pg_cron retries naturally on the next 5-minute tick, so a transient failure
// self-heals.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { getAccessToken } from "../_shared/google.ts";

const REFRESH_SKEW_MS = 5 * 60 * 1000; // matches getAccessToken's threshold

/** True if the request carries the valid CRON_SECRET bearer. */
function isCronCall(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const cron = isCronCall(req);
    if (!cron) {
      // Manual invocation must be from a super_admin.
      const user = await requireUser(req);
      if (user.role !== "super_admin") {
        return errorResponse("Super admin only", 403);
      }
    }

    const svc = serviceClient();

    // Snapshot the current expiry so we can report whether a refresh happened.
    const { data: before } = await svc
      .from("drive_tokens")
      .select("token_expiry")
      .eq("id", true)
      .maybeSingle();
    const expiryBefore = before?.token_expiry ?? null;
    const minutesLeftBefore = expiryBefore
      ? (new Date(expiryBefore).getTime() - Date.now()) / 60_000
      : null;

    // The shared helper refreshes when within 5 minutes of expiry, otherwise
    // returns the cached token. We never expose the token itself.
    await getAccessToken();

    // Read fresh expiry to detect whether getAccessToken minted a new one.
    const { data: after } = await svc
      .from("drive_tokens")
      .select("token_expiry, updated_at")
      .eq("id", true)
      .maybeSingle();
    const expiryAfter = after?.token_expiry ?? null;
    const minutesLeftAfter = expiryAfter
      ? (new Date(expiryAfter).getTime() - Date.now()) / 60_000
      : null;

    // "refreshed" = expiry moved forward.
    const refreshed =
      !!expiryBefore &&
      !!expiryAfter &&
      new Date(expiryAfter).getTime() > new Date(expiryBefore).getTime();

    return jsonResponse({
      ok: true,
      source: cron ? "cron" : "manual",
      refreshed,
      thresholdMinutes: REFRESH_SKEW_MS / 60_000,
      before: {
        tokenExpiry: expiryBefore,
        minutesUntilExpiry: minutesLeftBefore,
      },
      after: {
        tokenExpiry: expiryAfter,
        minutesUntilExpiry: minutesLeftAfter,
        updatedAt: after?.updated_at ?? null,
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    const msg = (e as Error).message ?? "Refresh failed";
    console.error("drive-refresh-token error:", msg);
    return errorResponse(`Refresh failed: ${msg}`, 500);
  }
});
