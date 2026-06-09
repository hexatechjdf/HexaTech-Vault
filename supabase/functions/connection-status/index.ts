// connection-status — returns non-secret connection info for the Settings UI.
// Any authenticated user with Settings access can read this; it NEVER returns
// any Google token. Also surfaces the last sync time (item 02 "Last synced").

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    await requireUser(req); // any authenticated app_user
    const svc = serviceClient();

    const { data: conn } = await svc
      .from("drive_connection")
      .select("google_account_email, root_folder_name, connected_at")
      .eq("id", true)
      .maybeSingle();

    let lastSyncAt: string | null = null;
    const { data: lastRun } = await svc
      .from("sync_runs")
      .select("finished_at")
      .eq("status", "success")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastSyncAt = lastRun?.finished_at ?? null;

    return jsonResponse({
      connected: !!conn,
      accountEmail: conn?.google_account_email ?? null,
      rootFolderName: conn?.root_folder_name ?? null,
      connectedAt: conn?.connected_at ?? null,
      lastSyncAt,
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("connection-status error:", e);
    return errorResponse("Internal error", 500);
  }
});
