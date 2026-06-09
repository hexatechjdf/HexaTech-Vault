// POST /api/admin/drive/my-folders
// Returns: { folders: FolderDTO[] }
//
// Lists every folder the caller has been granted access to (via direct user
// grant or folder_assignees row). This is the entry point for non-super-admin
// users whose role doesn't include access to the company root.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST() {
  const r = await callEdgeFunction({ name: "shared-with-me", method: "POST" });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
