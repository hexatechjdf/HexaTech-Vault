// GET /api/admin/audit-logs
//
// Returns the most recent audit log entries, joined with the actor's name,
// role, and department. Gated by the Tab Permission engine: caller must hold
// `audit_logs ≥ view` (super_admin short-circuits). We then read with the
// service-role client because the audit_log table's RLS policies only allow
// SELECT for super_admin + admin — anyone else granted view via the tab
// engine would see 0 rows through a user-scoped client.
//
// Query params:
//   ?limit=NNN  — caps the page size (default 500, hard ceiling 1000).

import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireTabLevel } from "@/lib/server/require-tab-level";

export const dynamic = 'force-dynamic';

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
  const gate = await requireTabLevel(req, "audit_logs", "view");
  if (gate instanceof NextResponse) return gate;

  const url = new URL(req.url);
  const rawLimit = parseInt(url.searchParams.get("limit") ?? "500", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
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
