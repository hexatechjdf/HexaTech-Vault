// /api/admin/tabs/permissions
//
// GET  - List every tab grant (super-admin only). Relays to the
//        `tab-permissions-get` Edge Function.
// POST - Upsert / delete a single tab grant (super-admin only). Relays to the
//        `tab-permissions-set` Edge Function with the request body verbatim.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = "force-dynamic";

export async function GET() {
  const r = await callEdgeFunction({ name: "tab-permissions-get", method: "GET" });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "tab-permissions-set", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
