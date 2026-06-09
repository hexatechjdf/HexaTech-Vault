// POST /api/admin/drive/sync
// Triggers a one-shot Drive→DB sync (same logic the hourly cron uses).
// Returns: { added, updated, removed, status, finishedAt }
//
// Useful for: forcing an immediate refresh after creating files outside the
// app (e.g. someone dragged files into the root folder directly in Drive).

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST() {
  const r = await callEdgeFunction({ name: "sync-drive", method: "POST" });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
