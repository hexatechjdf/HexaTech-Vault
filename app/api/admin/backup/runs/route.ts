// GET /api/admin/backup/runs?limit=NN
//
// Returns recent backup_runs entries. Gated by the Tab Permission engine:
// caller must hold settings ≥ view (super_admin short-circuits). Reads with
// the service-role client because the underlying RLS policies on
// backup_runs only allow super_admin SELECT.

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = 'force-dynamic';

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
  const gate = await requireTabLevel(req, "settings", "view");
  if (gate instanceof NextResponse) return gate;

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
