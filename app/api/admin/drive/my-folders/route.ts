// POST /api/admin/drive/my-folders
// Returns: { folders: FolderDTO[] }
//
// Lists every folder the caller has been granted access to (via direct user
// grant or folder_assignees row). This is the entry point for non-super-admin
// users whose role doesn't include access to the company root.
//
// Tab-permission gate: caller must hold file_manager ≥ view. Folder-level
// permissions still filter the returned list inside the Edge Function.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";
import { requireTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const gate = await requireTabLevel(req, "file_manager", "view");
  if (gate instanceof NextResponse) return gate;

  const r = await callEdgeFunction({ name: "shared-with-me", method: "POST" });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
