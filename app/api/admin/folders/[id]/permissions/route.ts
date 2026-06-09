// GET    /api/admin/folders/:id/permissions  -> { grants: GrantDTO[] }
// POST   /api/admin/folders/:id/permissions  -> upsert one grant
//        Body: { principalType, principalId, level, expiresAt? }
//
// Both endpoints relay to Edge Functions (permissions-get / permissions-set)
// which carry the actual Drive integration. The browser only talks to this
// BFF; the JWT propagation + Drive sharing happen server-side.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = await callEdgeFunction({
    name: "permissions-get",
    method: "POST", // Edge Function reads its target from the body, not the URL
    body: { folderId: params.id },
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({
    name: "permissions-set",
    method: "POST",
    body: { ...body, folderId: params.id },
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
