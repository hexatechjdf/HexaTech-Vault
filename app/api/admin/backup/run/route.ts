// POST /api/admin/backup/run
//
// Triggers a manual backup. Super-admin only — the Edge Function re-checks
// the role too, but gating at the BFF keeps the failure responses uniform
// with the rest of the admin surface.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callEdgeFunction } from "@/lib/server/call-edge";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

  const r = await callEdgeFunction({
    name: "backup-run",
    method: "POST",
    body: { source: "manual" },
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json(r.data, { status: 200 });
}
