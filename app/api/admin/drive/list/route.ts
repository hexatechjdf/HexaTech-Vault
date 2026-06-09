// POST /api/admin/drive/list
// Body: { folderId?: string }
// Returns: { folders, files, breadcrumb } from the drive-list Edge Function.
// Defaults to the company root when folderId is omitted.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-list", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
