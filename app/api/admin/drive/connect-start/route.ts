// POST /api/admin/drive/connect-start
//
// Super-admin starts (or restarts) the Google Drive OAuth flow. Returns the
// Google consent URL; the browser then `window.location = url`s to it.
//
// Auth is enforced both at the BFF (via the cookie session forwarded to the
// Edge Function) AND inside the Edge Function (requireSuperAdmin). Two layers
// keep us honest.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

interface ConnectStartDTO {
  url: string;
}

export async function POST() {
  const r = await callEdgeFunction<ConnectStartDTO>({
    name: "drive-oauth-start",
    method: "POST",
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
