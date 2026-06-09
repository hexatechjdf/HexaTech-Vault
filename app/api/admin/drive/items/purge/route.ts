// POST /api/admin/drive/items/purge
// Body: { id, kind: "folder" | "file" }
// Returns: { ok: true }
//
// Super-Admin-only. PERMANENT delete of a soft-deleted item:
//   - Drive: files.delete (bytes irrevocably removed)
//   - DB: hard-delete the cache row (FK cascades clean up permission_grants,
//     folder_assignees, descendants)
// Pre-condition: the item must already be soft-deleted (Trash flow only).
// Thin relay to the drive-purge Edge Function.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-purge", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
