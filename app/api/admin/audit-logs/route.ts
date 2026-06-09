// GET /api/admin/audit-logs
//
// Returns the most recent audit log entries, joined with the actor's name,
// role, and department. Cookie-authed: any active app_user can hit this
// endpoint, but RLS on the audit_log table scopes the results:
//   - super_admin  → sees every row
//   - admin        → sees rows whose actor is in their own department
//   - everyone else → 0 rows (their role has no SELECT policy on audit_log)
//
// Query params:
//   ?limit=NNN  — caps the page size (default 500, hard ceiling 1000).
//
// Why no role check on the BFF side: RLS is the source of truth and is
// idiomatic Supabase. Re-checking role here would mostly be redundant.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

interface ActorJoin {
  id: string;
  name: string | null;
  role: string | null;
  department_id: string | null;
  departments: { name: string } | { name: string }[] | null;
}

interface AuditRow {
  id: string;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown> | null;
  result: string;
  ip_address: string | null;
  created_at: string;
  actor: ActorJoin | ActorJoin[] | null;
}

export async function GET(req: Request) {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;

  const { data, error } = await supabase
    .from("audit_log")
    .select(
      "id, action, resource_type, resource_id, details, result, ip_address, created_at, actor:actor_id(id, name, role, department_id, departments(name))"
    )
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return bad(error.message || "Failed to load audit logs", 500);

  const logs = ((data ?? []) as AuditRow[]).map((row) => {
    const actor = (Array.isArray(row.actor) ? row.actor[0] : row.actor) ?? null;
    const dept = actor ? (Array.isArray(actor.departments) ? actor.departments[0] : actor.departments) : null;
    return {
      id: row.id,
      timestamp: row.created_at,
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? "System",
      actorRole: actor?.role ?? null,
      actorDepartment: dept?.name ?? null,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      result: row.result === "failure" ? "failure" : "success",
      ipAddress: row.ip_address,
    };
  });

  return NextResponse.json({ logs });
}
