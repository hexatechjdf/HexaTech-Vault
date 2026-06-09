// GET /api/admin/departments — list every department (id + name) for use in
// the Add User form's department dropdown. Any active authenticated user can
// read; RLS guards the table at the DB level too.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  const { data, error } = await supabase
    .from("departments")
    .select("id, name")
    .order("name", { ascending: true });
  if (error) return bad("Failed to load departments", 500);

  return NextResponse.json({ departments: data ?? [] });
}
