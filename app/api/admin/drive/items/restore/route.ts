// POST /api/admin/drive/items/restore
// Body: { id, kind: "folder" | "file" }
// Returns: { ok: true }
//
// Super-Admin-only. Restores a soft-deleted folder or file:
//   - Untrashes the item in Drive (Drive holds trashed items 30 days).
//   - Clears deleted_at on the cached row.
//   - For folders, cascade-restores every descendant that was deleted in the
//     same operation (matched by exact deleted_at timestamp).
// Thin relay to the drive-restore Edge Function.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-restore", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
