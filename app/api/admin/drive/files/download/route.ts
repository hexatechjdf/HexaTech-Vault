// POST /api/admin/drive/files/download
// Body: { fileId }
// Returns: { name, mimeType, webViewLink, webContentLink }
// The Edge Function does NOT proxy file bytes — it returns Google's short-lived
// view + download links, which the browser opens directly. No Drive token is
// ever sent to the browser.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "drive-download", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
