// tab-permissions-set — Upserts (or deletes) a single tab grant. Super-admin only.
//
// Input: { tab, principalType, principalId, principalDeptId?, level }
//
// Behaviour:
//   - level = 'no_access' AND a row exists -> DELETE the row. This matches the
//     "no row = no_access" semantics for ROLE grants. For USER grants we KEEP
//     the no_access row only when explicitly requested via the optional
//     `keepExplicit` flag (used when someone wants to override an inherited
//     role grant with an explicit user-level revocation).
//   - any other level                       -> UPSERT the grant (insert or
//     update level / granted_by).
//
// auth -> super_admin -> validate -> if role+dept, verify dept exists -> upsert
//   or delete -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

const VALID_LEVELS = ["no_access", "view", "action"] as const;
const VALID_TABS = [
  "user_management",
  "folder_access",
  "file_manager",
  "audit_logs",
  "storage_overview",
  "settings",
] as const;
const VALID_PRINCIPALS = ["user", "role"] as const;

type Level = (typeof VALID_LEVELS)[number];
type Tab = (typeof VALID_TABS)[number];
type Principal = (typeof VALID_PRINCIPALS)[number];

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    const tab = body.tab as Tab;
    const principalType = body.principalType as Principal;
    const principalId = body.principalId as string;
    const principalDeptId: string | null = body.principalDeptId ?? null;
    const level = body.level as Level;
    const keepExplicit: boolean = body.keepExplicit === true;

    if (!tab || !principalType || !principalId || !level) {
      return errorResponse("tab, principalType, principalId and level are required", 400);
    }
    if (!VALID_TABS.includes(tab)) return errorResponse("Invalid tab", 400);
    if (!VALID_PRINCIPALS.includes(principalType)) return errorResponse("Invalid principalType", 400);
    if (!VALID_LEVELS.includes(level)) return errorResponse("Invalid level", 400);
    if (principalType === "user" && principalDeptId) {
      return errorResponse("principalDeptId may only be set when principalType='role'", 400);
    }

    const svc = serviceClient();

    // Super-admin gate.
    const { data: caller } = await svc
      .from("app_users")
      .select("role, status")
      .eq("id", user.id)
      .maybeSingle();
    if (!caller || caller.status !== "active") throw new HttpError(403, "Account inactive");
    if (caller.role !== "super_admin") throw new HttpError(403, "Super admin only");

    // Granting to the super_admin role is a no-op (engine short-circuits).
    // Reject it loudly so admins don't create dead rows.
    if (principalType === "role" && principalId === "super_admin") {
      return errorResponse(
        "super_admin already has 'action' on every tab — no grant needed",
        422,
      );
    }

    // Validate dept reference if present.
    if (principalType === "role" && principalDeptId) {
      const { data: dept } = await svc
        .from("departments")
        .select("id")
        .eq("id", principalDeptId)
        .maybeSingle();
      if (!dept) return errorResponse("principalDeptId does not match a real department", 422);
    }

    const ip = clientIp(req);

    // Path A: level = no_access AND no explicit-override requested -> DELETE.
    // For role grants we ALWAYS delete (matches migration 0022's policy that
    // no_access role rows are forbidden).
    if (level === "no_access" && (principalType === "role" || !keepExplicit)) {
      const delQ = svc
        .from("tab_permission_grants")
        .delete()
        .eq("tab", tab)
        .eq("principal_type", principalType)
        .eq("principal_id", principalId);
      if (principalDeptId) {
        delQ.eq("principal_dept_id", principalDeptId);
      } else {
        delQ.is("principal_dept_id", null);
      }
      const { error: delErr, count } = await delQ.select("id", { count: "exact" });
      if (delErr) throw new HttpError(500, delErr.message);

      await writeAudit({
        actorId: user.id,
        action: "tab.permission_delete",
        resourceType: "tab",
        resourceId: tab,
        details: { tab, principalType, principalId, principalDeptId, level },
        ipAddress: ip,
      });

      return jsonResponse({ ok: true, deleted: count ?? 0 });
    }

    // Path B: UPSERT.
    // We can't rely on Supabase-js .upsert() with COALESCE-based uniqueness,
    // so do a manual "delete by key + insert" to keep semantics simple.
    {
      const delQ = svc
        .from("tab_permission_grants")
        .delete()
        .eq("tab", tab)
        .eq("principal_type", principalType)
        .eq("principal_id", principalId);
      if (principalDeptId) {
        delQ.eq("principal_dept_id", principalDeptId);
      } else {
        delQ.is("principal_dept_id", null);
      }
      const { error: delErr } = await delQ;
      if (delErr) throw new HttpError(500, delErr.message);
    }

    const { data: inserted, error: insErr } = await svc
      .from("tab_permission_grants")
      .insert({
        tab,
        principal_type: principalType,
        principal_id: principalId,
        principal_dept_id: principalDeptId,
        level,
        granted_by: user.id,
      })
      .select("id, tab, principal_type, principal_id, principal_dept_id, level, granted_at")
      .single();
    if (insErr || !inserted) throw new HttpError(500, insErr?.message ?? "Failed to write grant");

    await writeAudit({
      actorId: user.id,
      action: "tab.permission_set",
      resourceType: "tab",
      resourceId: tab,
      details: { tab, principalType, principalId, principalDeptId, level },
      ipAddress: ip,
    });

    return jsonResponse({
      ok: true,
      grant: {
        id: inserted.id,
        tab: inserted.tab,
        principalType: inserted.principal_type,
        principalId: inserted.principal_id,
        principalDeptId: inserted.principal_dept_id,
        level: inserted.level,
        grantedAt: inserted.granted_at,
      },
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("tab-permissions-set error:", e);
    return errorResponse((e as Error).message || "Internal error", 500);
  }
});
