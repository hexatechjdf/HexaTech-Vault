// GET /api/admin/drive/status
//
// Returns the current Drive connection state (connected? which account? which
// root folder? when was it connected? when was the last sync?). Cookie-authed;
// relays the call to the connection-status Edge Function so the Drive logic
// stays server-side.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = 'force-dynamic';

interface ConnectionStatusDTO {
  connected: boolean;
  accountEmail: string | null;
  rootFolderName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

export async function GET() {
  const r = await callEdgeFunction<ConnectionStatusDTO>({
    name: "connection-status",
    method: "POST", // connection-status uses Deno.serve which accepts any method; POST keeps it consistent with the rest of our Edge Functions
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
