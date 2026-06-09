"use client";

// React Query hook for the audit log.
//
// The BFF (GET /api/admin/audit-logs) does the auth, joins the actor's
// profile, and emits a shaped DTO. RLS scopes which rows the caller sees
// (super_admin = everything; admin = their department only).

import { useQuery } from "@tanstack/react-query";

export interface AuditLogEntry {
  id: string;
  /** ISO 8601 (UTC) timestamp from Postgres. */
  timestamp: string;
  actorId: string | null;
  /** Best-effort label — "System" if the row has no actor link. */
  actorName: string;
  /** Snake_case role from the user_role enum, or null for system rows. */
  actorRole: string | null;
  actorDepartment: string | null;
  /** Dotted action code, e.g. "admin.user_create" / "admin.branding_update". */
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  result: "success" | "failure";
  ipAddress: string | null;
}

export const auditQueryKeys = {
  logs: ["audit-logs"] as const,
  withLimit: (limit: number) => ["audit-logs", { limit }] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchAuditLogs(limit?: number): Promise<AuditLogEntry[]> {
  const url = "/api/admin/audit-logs" + (limit ? `?limit=${limit}` : "");
  const res = await fetch(url, { cache: "no-store" });
  const data = await asJson<{ logs: AuditLogEntry[] }>(res, "Failed to load audit logs");
  return data.logs;
}

export function useAuditLogs(limit?: number) {
  return useQuery({
    queryKey: limit ? auditQueryKeys.withLimit(limit) : auditQueryKeys.logs,
    queryFn: () => fetchAuditLogs(limit),
  });
}
