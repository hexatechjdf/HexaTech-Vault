// POST /api/admin/drive/verify
//
// Super-admin clicks "Verify connection" in Settings → Google Drive. The
// Edge Function uses the stored refresh token to mint a fresh access token,
// calls Drive's /about endpoint, and confirms the cached root folder still
// exists. Returns a typed result the UI can render directly.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

interface VerifyDTO {
  ok: boolean;
  reason?: "not_connected" | "token_revoked" | "root_missing" | "drive_error";
  accountEmail?: string | null;
  rootFolderName?: string | null;
}

export async function POST() {
  const r = await callEdgeFunction<VerifyDTO>({
    name: "drive-verify",
    method: "POST",
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
