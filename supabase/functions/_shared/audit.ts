// writeAudit(...): appends a row to audit_log. Every privileged/mutating action
// must call this (Foundation §8). Audit writes never throw to the caller — a
// logging failure must not break the user action — but they are best-effort.

import { serviceClient } from "./supabase.ts";

export interface AuditArgs {
  actorId: string | null;
  action: string; // e.g. 'drive.connect', 'folder.create', 'perm.grant', 'file.download'
  resourceType?: string | null; // 'folder' | 'file' | 'connection' | 'permission'
  resourceId?: string | null;
  details?: Record<string, unknown> | null;
  result?: "success" | "failure";
  ipAddress?: string | null;
}

export async function writeAudit(args: AuditArgs): Promise<void> {
  try {
    await serviceClient().from("audit_log").insert({
      actor_id: args.actorId,
      action: args.action,
      resource_type: args.resourceType ?? null,
      resource_id: args.resourceId ?? null,
      details: args.details ?? null,
      result: args.result ?? "success",
      ip_address: args.ipAddress ?? null,
    });
  } catch (e) {
    // Do not surface logging errors to the client; record to function logs.
    console.error("writeAudit failed:", e);
  }
}

/** Extracts a best-effort client IP from forwarding headers. */
export function clientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("cf-connecting-ip") ??
    null
  );
}
