// POST /api/admin/drive/list
// Body: { folderId?: string }
// Returns: { folders, files, breadcrumb } from the drive-list Edge Function.
// Defaults to the company root when folderId is omitted.
//
// Tab-permission gate: caller must hold file_manager ≥ view. Folder-level
// permissions still apply inside the Edge Function (they decide WHICH folders
// the caller sees). The tab gate is the "door" — without view on the
// file_manager tab the caller has no business hitting this route at all.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";
import { requireTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await requireTabLevel(req, "file_manager", "view");
  if (gate instanceof NextResponse) return gate;

  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-list", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
