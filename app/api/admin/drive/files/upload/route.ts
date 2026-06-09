// POST /api/admin/drive/files/upload
// Body: { folderId, name, mimeType, contentBase64? }
// Returns: { file } — the newly uploaded file DTO.
//
// For now the file content is sent as base64 in the JSON body. This is fine
// for files up to ~5 MB; for larger files we'll need a streaming /
// resumable upload later (see uploadSmallFile TODO in _shared/google.ts).

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-upload", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 201 });
}
