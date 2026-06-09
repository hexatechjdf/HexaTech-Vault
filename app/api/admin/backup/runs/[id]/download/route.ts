// GET /api/admin/backup/runs/[id]/download
//
// Returns a short-lived signed URL the browser can use to download the
// archive object from the private `backups` bucket. Super-admin only.
//
// Note: we deliberately do NOT proxy the bytes through the BFF. Large
// backups would saturate the Node runtime; a direct signed-URL fetch from
// Supabase Storage is fast and cheap.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — enough for a manual download.

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

  const { id } = await context.params;
  if (!id) return bad("Missing run id");

  const admin = createSupabaseAdminClient();

  // Resolve the bucket from backup_config so a future bucket migration
  // doesn't require touching this route.
  const [{ data: run }, { data: cfg }] = await Promise.all([
    admin.from("backup_runs").select("status, object_path").eq("id", id).maybeSingle(),
    admin.from("backup_config").select("bucket").eq("id", true).maybeSingle(),
  ]);

  if (!run) return bad("Backup run not found", 404);
  if (run.status !== "success" || !run.object_path) {
    return bad("This backup is not downloadable (status != success)", 409);
  }
  if (!cfg?.bucket) return bad("backup_config not initialized", 500);

  const { data: signed, error } = await admin.storage
    .from(cfg.bucket as string)
    .createSignedUrl(run.object_path as string, SIGNED_URL_TTL_SECONDS, {
      download: (run.object_path as string).split("/").pop() ?? "backup.json.gz",
    });
  if (error || !signed?.signedUrl) {
    return bad(error?.message || "Failed to sign download URL", 500);
  }

  return NextResponse.json({
    url: signed.signedUrl,
    expiresInSeconds: SIGNED_URL_TTL_SECONDS,
  });
}
