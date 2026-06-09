// POST /api/admin/drive/folders
// Body: { parentFolderId, name, ownerDepartmentId, roleContext?, access?: [] }
// Returns: { folder } — the newly created folder DTO.
// Relays to folder-create Edge Function (which creates in Drive + caches locally).

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "folder-create", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}
