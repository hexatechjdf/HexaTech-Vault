// backup-run — snapshot the app's Postgres state to a gzipped JSON archive
// in Supabase Storage. Triggerable by (a) the daily cron (Bearer CRON_SECRET)
// or (b) a super_admin POST from the Settings → Backup tab.
//
// Tables included:
//   departments, app_users, folders, files, permission_grants,
//   folder_assignees, branding.
//
// Tables EXCLUDED (intentionally):
//   audit_log     — grows large; restored via app behavior, not state copy.
//   drive_tokens  — secrets; restore re-runs Drive OAuth.
//   drive_connection / sync_state — operational state tied to the live
//                                   Drive credential; same reason.
//   backup_config / backup_runs   — meta-state for the backup engine itself.
//
// Each run:
//   - read backup_config (bail if disabled)
//   - if cron, gate by frequency (daily=always, weekly=Sun UTC, monthly=day 1)
//   - insert a backup_runs(running) row
//   - SELECT * each backed-up table via service-role client
//   - JSON-encode → gzip → upload to bucket/yyyy/mm/dd/backup-<runId>.json.gz
//   - mark the run success/failed, write audit log
//   - purge runs older than retention_days (DB row + storage object)

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

interface BackupConfigRow {
  enabled: boolean;
  frequency: "daily" | "weekly" | "monthly";
  retention_days: number;
  bucket: string;
}

// Tables to snapshot, in a stable order. The order doesn't affect correctness,
// only the on-disk layout of the archive.
const TABLES = [
  "departments",
  "app_users",
  "branding",
  "folders",
  "files",
  "permission_grants",
  "folder_assignees",
] as const;

function isCronCall(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

/** True when today (UTC) matches the configured frequency cadence. */
function dueToday(frequency: BackupConfigRow["frequency"], now: Date): boolean {
  if (frequency === "daily") return true;
  if (frequency === "weekly") return now.getUTCDay() === 0; // Sunday
  if (frequency === "monthly") return now.getUTCDate() === 1;
  return true;
}

/** "2026/06/09/backup-<uuid>.json.gz" — date prefix keeps the bucket browsable. */
function objectPathFor(runId: string, now: Date): string {
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}/${mm}/${dd}/backup-${runId}.json.gz`;
}

/** Gzip a string → Uint8Array using the standard Web Streams API. */
async function gzip(input: string): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const svc = serviceClient();
  const now = new Date();
  const cron = isCronCall(req);

  // ── AuthZ: scheduler secret OR super_admin user ─────────────────────────
  let actorId: string | null = null;
  if (!cron) {
    try {
      const user = await requireUser(req);
      if (user.role !== "super_admin") {
        return errorResponse("Super admin only", 403);
      }
      actorId = user.id;
    } catch (e) {
      if (e instanceof HttpError) return errorResponse(e.message, e.status);
      throw e;
    }
  }

  // ── Read config; bail early if disabled or not due (cron only) ──────────
  const { data: cfg, error: cfgErr } = await svc
    .from("backup_config")
    .select("enabled, frequency, retention_days, bucket")
    .eq("id", true)
    .maybeSingle();
  if (cfgErr || !cfg) {
    return errorResponse("backup_config not initialized", 500);
  }
  const config = cfg as BackupConfigRow;

  if (!config.enabled) {
    return jsonResponse({ skipped: true, reason: "Backups are disabled" }, 200);
  }
  if (cron && !dueToday(config.frequency, now)) {
    return jsonResponse({
      skipped: true,
      reason: `Frequency=${config.frequency}; not due today (UTC)`,
    }, 200);
  }

  // ── Insert the run row up front so failures are still recorded ──────────
  const { data: run, error: runErr } = await svc
    .from("backup_runs")
    .insert({
      status: "running",
      triggered_by: cron ? "cron" : "manual",
      actor_id: actorId,
    })
    .select("id")
    .single();
  if (runErr || !run) {
    return errorResponse("Failed to start backup run", 500);
  }
  const runId = run.id as string;

  try {
    // ── Snapshot every backed-up table via service-role SELECT * ─────────
    const tables: Record<string, unknown[]> = {};
    for (const t of TABLES) {
      const { data, error } = await svc.from(t).select("*");
      if (error) throw new Error(`Failed to read ${t}: ${error.message}`);
      tables[t] = data ?? [];
    }

    const archive = {
      version: 1,
      app: "hexatech-vault",
      generatedAt: now.toISOString(),
      generatedBy: cron ? "cron" : "manual",
      tables,
    };
    const json = JSON.stringify(archive);
    const gz = await gzip(json);
    const objectPath = objectPathFor(runId, now);

    // ── Upload archive. upsert=false; if the path already exists something
    //    is wrong (the UUID collision case is astronomical), fail loudly. ─
    const { error: upErr } = await svc.storage
      .from(config.bucket)
      .upload(objectPath, gz, {
        contentType: "application/gzip",
        upsert: false,
      });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    // ── Mark success ─────────────────────────────────────────────────────
    await svc
      .from("backup_runs")
      .update({
        status: "success",
        finished_at: new Date().toISOString(),
        bytes: gz.byteLength,
        object_path: objectPath,
      })
      .eq("id", runId);

    // ── Retention purge: delete DB rows + storage objects older than N days
    //    (success rows only — failed rows are kept so an admin can see the
    //    error history). Best-effort; a failure here doesn't fail the run. ─
    try {
      const cutoff = new Date(now.getTime() - config.retention_days * 86400000).toISOString();
      const { data: stale } = await svc
        .from("backup_runs")
        .select("id, object_path")
        .lt("started_at", cutoff)
        .eq("status", "success")
        .not("object_path", "is", null);
      const oldPaths = (stale ?? []).map((r) => r.object_path as string).filter(Boolean);
      if (oldPaths.length) {
        await svc.storage.from(config.bucket).remove(oldPaths);
      }
      const oldIds = (stale ?? []).map((r) => r.id as string);
      if (oldIds.length) {
        await svc.from("backup_runs").delete().in("id", oldIds);
      }
    } catch (purgeErr) {
      console.error("retention purge error:", purgeErr);
    }

    await writeAudit({
      actorId,
      action: "backup.run",
      resourceType: "backup",
      resourceId: runId,
      details: {
        bytes: gz.byteLength,
        objectPath,
        frequency: config.frequency,
        triggeredBy: cron ? "cron" : "manual",
      },
      ipAddress: clientIp(req),
    });

    return jsonResponse({
      ok: true,
      runId,
      bytes: gz.byteLength,
      objectPath,
    });
  } catch (inner) {
    const msg = String((inner as Error)?.message ?? inner).slice(0, 500);
    await svc
      .from("backup_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: msg,
      })
      .eq("id", runId);

    await writeAudit({
      actorId,
      action: "backup.run",
      resourceType: "backup",
      resourceId: runId,
      details: { error: msg, triggeredBy: cron ? "cron" : "manual" },
      result: "failure",
      ipAddress: clientIp(req),
    });

    // 200 even on failure so the scheduler does not treat it as a transport
    // error and spam retries — the failure is recorded in backup_runs.
    return jsonResponse({ ok: false, runId, error: msg }, 200);
  }
});
