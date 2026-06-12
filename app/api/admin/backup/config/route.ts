// /api/admin/backup/config
//
// GET  — super_admin only. Returns the singleton backup_config row.
// PUT  — super_admin only. Updates any subset of { enabled, frequency,
//        retentionDays }. Validates frequency against the enum and clamps
//        retentionDays to [1, 365]. Stamps updated_at + updated_by from the
//        cookie session (never trusts the body).
//
// The backup_config table has a singleton constraint (id boolean primary key
// default true check (id)), so updates always target the same row.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";
import { resolveTabLevel } from "@/lib/server/require-tab-level";
import type { TabLevel } from "@/lib/tabs";

export const dynamic = 'force-dynamic';

const LEVEL_RANK: Record<TabLevel, number> = { no_access: 0, view: 1, action: 2 };

const FREQUENCIES = ["daily", "weekly", "monthly"] as const;
type Frequency = (typeof FREQUENCIES)[number];

interface BackupConfigRow {
  enabled: boolean;
  frequency: Frequency;
  retention_days: number;
  bucket: string;
  updated_at: string | null;
}

function toDTO(row: BackupConfigRow) {
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    retentionDays: row.retention_days,
    bucket: row.bucket,
    updatedAt: row.updated_at,
  };
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Gates on the settings tab engine (the Backup UI lives inside Settings).
// Super admins always pass. Everyone else needs the required level
// (view for reads, action for writes).
async function resolveCaller(required: TabLevel) {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return { error: bad("Not signed in", 401) } as const;

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") {
    return { error: bad("Account inactive", 403) } as const;
  }

  if (caller.role !== "super_admin") {
    const level = await resolveTabLevel(authUser.id, "settings");
    if (LEVEL_RANK[level] < LEVEL_RANK[required]) {
      return { error: bad("Insufficient permission on Settings", 403) } as const;
    }
  }
  return { caller } as const;
}

export async function GET() {
  const r = await resolveCaller("view");
  if ("error" in r) return r.error;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("backup_config")
    .select("enabled, frequency, retention_days, bucket, updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error) return bad(error.message || "Failed to load backup config", 500);
  if (!data) return bad("backup_config not initialized", 500);
  return NextResponse.json(toDTO(data as BackupConfigRow));
}

interface UpdateBody {
  enabled?: unknown;
  frequency?: unknown;
  retentionDays?: unknown;
}

export async function PUT(req: Request) {
  const r = await resolveCaller("action");
  if ("error" in r) return r.error;

  const body = (await req.json().catch(() => ({}))) as UpdateBody;
  const update: Record<string, unknown> = {};

  if (body.enabled !== undefined) {
    if (typeof body.enabled !== "boolean") return bad("`enabled` must be boolean");
    update.enabled = body.enabled;
  }
  if (body.frequency !== undefined) {
    if (typeof body.frequency !== "string" || !FREQUENCIES.includes(body.frequency as Frequency)) {
      return bad(`\`frequency\` must be one of ${FREQUENCIES.join(", ")}`);
    }
    update.frequency = body.frequency;
  }
  if (body.retentionDays !== undefined) {
    const n = Number(body.retentionDays);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
      return bad("`retentionDays` must be an integer");
    }
    if (n < 1 || n > 365) return bad("`retentionDays` must be between 1 and 365");
    update.retention_days = n;
  }
  if (Object.keys(update).length === 0) {
    return bad("No valid fields to update");
  }

  update.updated_at = new Date().toISOString();
  update.updated_by = r.caller.id;

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("backup_config")
    .update(update)
    .eq("id", true)
    .select("enabled, frequency, retention_days, bucket, updated_at")
    .maybeSingle();
  if (error || !data) return bad(error?.message || "Update failed", 500);

  // Audit the config change so the trail shows who toggled / re-scheduled.
  await admin.from("audit_log").insert({
    actor_id: r.caller.id,
    action: "admin.backup_config_update",
    resource_type: "backup_config",
    details: {
      enabled: update.enabled ?? null,
      frequency: update.frequency ?? null,
      retentionDays: update.retention_days ?? null,
    },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  return NextResponse.json(toDTO(data as BackupConfigRow));
}
