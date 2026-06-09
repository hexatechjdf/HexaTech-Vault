// GET /api/admin/backup/runs?limit=NN
//
// Returns recent backup_runs entries (super_admin only). RLS already restricts
// SELECT to super_admin, but we gate at the BFF too to keep failure responses
// consistent with the rest of the admin surface and to validate the limit.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

interface RunRow {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  bytes: number | null;
  object_path: string | null;
  error: string | null;
  triggered_by: "cron" | "manual";
}

function toDTO(r: RunRow) {
  return {
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    bytes: r.bytes,
    objectPath: r.object_path,
    error: r.error,
    triggeredBy: r.triggered_by,
  };
}

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: Request) {
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

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("backup_runs")
    .select("id, started_at, finished_at, status, bytes, object_path, error, triggered_by")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return bad(error.message || "Failed to load backup runs", 500);

  return NextResponse.json({ runs: (data as RunRow[]).map(toDTO) });
}
