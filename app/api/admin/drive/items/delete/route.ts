// POST /api/admin/drive/items/delete
// Body: { id, kind: "folder" | "file" }
// Returns: { ok: true }
// Trashes the item in Drive and marks deleted_at locally (cascades to subtree
// for folders). The Drive Trash is reversible — we don't hard-delete here.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-delete", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
