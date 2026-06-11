// POST /api/admin/drive/proposals/clone
// Body: { sourceFileId, clientName, projectTitle }
//
// Clones an existing proposal sample file into a freshly-created project
// folder under the same Proposal folder. The Edge Function (`proposal-clone`)
// does the full work: validates the sample lives inside a folder named
// "Proposal", checks for duplicate names, creates the project folder in
// Drive + DB, copies the sample file in, audits.
//
// Thin BFF relay. The browser never touches the Edge Function directly.

import { NextResponse } from "next/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const r = await callEdgeFunction({ name: "proposal-clone", method: "POST", body });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
