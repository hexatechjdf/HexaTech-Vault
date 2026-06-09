// sync-drive (item 02) — keep the Postgres metadata cache fresh.
// Triggerable by:
//   (a) the scheduler — Authorization: Bearer <CRON_SECRET>, OR
//   (b) a super_admin "Sync now" button — normal JWT.
//
// Each run: insert sync_runs(running) -> getAccessToken -> incremental via
// changes.list (sync_state.start_page_token) OR baseline recursive listing
// under the root -> upsert folders/files by drive_file_id (handle move/rename/
// trash -> deleted_at) -> update sync_runs counts+status. Idempotent; backoff on
// 429 is handled in google.ts; overlapping runs are guarded.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  getAccessToken,
  listChildren,
  changesList,
  getStartPageToken,
  getFile,
  DriveFile,
  FOLDER_MIME,
} from "../_shared/google.ts";
import { getRootFolderId } from "../_shared/root.ts";

interface Counts {
  added: number;
  updated: number;
  removed: number;
}

/** True if the request carries the valid CRON_SECRET bearer. */
function isCronCall(req: Request): boolean {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  const svc = serviceClient();

  try {
    // ---- AuthZ: scheduler secret OR super_admin ----
    if (!isCronCall(req)) {
      const user = await requireUser(req);
      if (user.role !== "super_admin") {
        return errorResponse("Super admin only", 403);
      }
    }

    // ---- Overlap guard: refuse if a run is already 'running' (item 02) ----
    const { data: running } = await svc
      .from("sync_runs")
      .select("id, started_at")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (running) {
      // Treat a run started < 30 min ago as still in flight.
      const ageMs = Date.now() - new Date(running.started_at).getTime();
      if (ageMs < 30 * 60 * 1000) {
        return jsonResponse({ skipped: true, reason: "A sync run is already in progress" }, 200);
      }
      // Stale 'running' row — mark it errored so we can proceed.
      await svc
        .from("sync_runs")
        .update({ status: "error", error: "Superseded (stale running run)", finished_at: new Date().toISOString() })
        .eq("id", running.id);
    }

    // ---- Start a run ----
    const { data: run, error: runErr } = await svc
      .from("sync_runs")
      .insert({ status: "running" })
      .select("id")
      .single();
    if (runErr || !run) throw new Error("Failed to start sync run");
    const runId = run.id;

    const counts: Counts = { added: 0, updated: 0, removed: 0 };

    try {
      const accessToken = await getAccessToken();
      const rootId = await getRootFolderId();

      const { data: state } = await svc
        .from("sync_state")
        .select("start_page_token")
        .eq("id", true)
        .maybeSingle();

      if (state?.start_page_token) {
        // ---- Incremental path (preferred) ----
        await runIncremental(svc, accessToken, rootId, state.start_page_token, counts);
      } else {
        // ---- Baseline path: recursive listing under the root ----
        await runBaseline(svc, accessToken, rootId, counts);
        // Establish a page token so subsequent runs are incremental.
        const token = await getStartPageToken(accessToken);
        await svc.from("sync_state").upsert({
          id: true,
          start_page_token: token,
          updated_at: new Date().toISOString(),
        });
      }

      await svc
        .from("sync_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          added: counts.added,
          updated: counts.updated,
          removed: counts.removed,
        })
        .eq("id", runId);

      return jsonResponse({ ok: true, runId, ...counts });
    } catch (inner) {
      // Record the failure but never crash the scheduler. Connection stays.
      await svc
        .from("sync_runs")
        .update({
          status: "error",
          finished_at: new Date().toISOString(),
          error: String((inner as Error)?.message ?? inner).slice(0, 500),
          added: counts.added,
          updated: counts.updated,
          removed: counts.removed,
        })
        .eq("id", runId);
      return jsonResponse(
        { ok: false, runId, error: "Sync failed; recorded for retry" },
        200, // 200 so the scheduler does not treat it as a transport error
      );
    }
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("sync-drive error:", e);
    return errorResponse("Internal error", 500);
  }
});

// ---------------------------------------------------------------------------
// Baseline: walk the root subtree breadth-first and upsert everything.
// Idempotent — safe to re-run.
// ---------------------------------------------------------------------------
async function runBaseline(
  svc: ReturnType<typeof serviceClient>,
  accessToken: string,
  rootId: string,
  counts: Counts,
): Promise<void> {
  // BFS queue of Drive folder ids whose children we still need to list.
  const queue: string[] = [rootId];
  const seen = new Set<string>([rootId]);

  while (queue.length > 0) {
    const parentDriveId = queue.shift()!;
    let pageToken: string | undefined;
    do {
      const { files, nextPageToken } = await listChildren(accessToken, parentDriveId, pageToken);
      for (const f of files) {
        if (f.mimeType === FOLDER_MIME) {
          await upsertFolder(svc, f, parentDriveId, counts);
          if (!seen.has(f.id)) {
            seen.add(f.id);
            queue.push(f.id);
          }
        } else {
          await upsertFile(svc, f, parentDriveId, counts);
        }
      }
      pageToken = nextPageToken;
    } while (pageToken);
  }
}

// ---------------------------------------------------------------------------
// Incremental: process Drive changes since the stored page token.
// ---------------------------------------------------------------------------
async function runIncremental(
  svc: ReturnType<typeof serviceClient>,
  accessToken: string,
  rootId: string,
  startToken: string,
  counts: Counts,
): Promise<void> {
  let pageToken: string | undefined = startToken;
  let newStartToken: string | undefined;

  while (pageToken) {
    const { changes, nextPageToken, newStartPageToken } = await changesList(accessToken, pageToken);
    for (const change of changes) {
      // Skip changes to the company root folder itself. Its parent in Drive
      // is the user's "My Drive" sentinel ("root"), which is NOT our company
      // root, so the isWithinRoot check below would (wrongly) soft-delete it.
      // The root is created once at OAuth-callback time and lives as long as
      // the Drive connection does — we never want to mark it deleted from a
      // sync run.
      if (change.fileId === rootId || change.file?.id === rootId) continue;

      // Drive Changes API distinguishes two "gone" states:
      //   - change.removed === true       => permanently removed in Drive
      //                                      (Super Admin emptied Drive Trash,
      //                                      or Drive's 30-day auto-purge fired)
      //   - change.file?.trashed === true => still in Drive Trash (recoverable)
      //
      // Match each to the DB action that mirrors it:
      //   - Permanently gone in Drive => hard-delete the cache row so the app's
      //     Trash view no longer shows it (recovery would fail anyway since
      //     Drive can't restore deleted bytes). FK cascades clean up children.
      //   - Trashed in Drive => set deleted_at (preserves the recovery window).
      if (change.removed) {
        await purgeFromCache(svc, change.fileId, counts);
        continue;
      }
      if (change.file?.trashed) {
        await markDeleted(svc, change.fileId, counts);
        continue;
      }
      const f = change.file;
      if (!f) continue;

      // Only cache items within the root subtree. Items moved outside the root
      // are treated as removed from our view (item 03 scope rule).
      const parentId = f.parents?.[0];
      const insideRoot = parentId ? await isWithinRoot(svc, parentId, rootId, accessToken) : false;
      if (!insideRoot) {
        await markDeleted(svc, f.id, counts);
        continue;
      }

      if (f.mimeType === FOLDER_MIME) {
        await upsertFolder(svc, f, parentId!, counts);
      } else {
        await upsertFile(svc, f, parentId!, counts);
      }
    }
    newStartToken = newStartPageToken ?? newStartToken;
    pageToken = nextPageToken;
  }

  if (newStartToken) {
    await svc.from("sync_state").upsert({
      id: true,
      start_page_token: newStartToken,
      updated_at: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolves the local folder id for a Drive folder id (parent linkage). */
async function localFolderId(
  svc: ReturnType<typeof serviceClient>,
  driveId: string,
): Promise<string | null> {
  const { data } = await svc
    .from("folders")
    .select("id")
    .eq("drive_file_id", driveId)
    .maybeSingle();
  return data?.id ?? null;
}

async function upsertFolder(
  svc: ReturnType<typeof serviceClient>,
  f: DriveFile,
  parentDriveId: string,
  counts: Counts,
): Promise<void> {
  const parentLocalId = await localFolderId(svc, parentDriveId);
  const { data: existing } = await svc
    .from("folders")
    .select("id")
    .eq("drive_file_id", f.id)
    .maybeSingle();

  // Compute path from parent (reparent-aware).
  let path = `/${f.name}`;
  if (parentLocalId) {
    const { data: parent } = await svc
      .from("folders")
      .select("path")
      .eq("id", parentLocalId)
      .maybeSingle();
    path = `${(parent?.path ?? "").replace(/\/$/, "")}/${f.name}`;
  }

  const row = {
    drive_file_id: f.id,
    name: f.name,
    parent_id: parentLocalId,
    is_root: false,
    path,
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };
  await svc.from("folders").upsert(row, { onConflict: "drive_file_id" });
  if (existing) counts.updated++;
  else counts.added++;
}

async function upsertFile(
  svc: ReturnType<typeof serviceClient>,
  f: DriveFile,
  parentDriveId: string,
  counts: Counts,
): Promise<void> {
  const folderLocalId = await localFolderId(svc, parentDriveId);
  if (!folderLocalId) {
    // Parent folder not yet cached; skip — it will be picked up once the parent
    // folder is upserted (baseline visits parents first; next sync reconciles).
    return;
  }
  const { data: existing } = await svc
    .from("files")
    .select("id")
    .eq("drive_file_id", f.id)
    .maybeSingle();

  const row = {
    drive_file_id: f.id,
    name: f.name,
    mime_type: f.mimeType,
    size_bytes: f.size ? Number(f.size) : null,
    folder_id: folderLocalId,
    web_view_link: f.webViewLink ?? null,
    modified_at: f.modifiedTime ?? null,
    deleted_at: null,
  };
  await svc.from("files").upsert(row, { onConflict: "drive_file_id" });
  if (existing) counts.updated++;
  else counts.added++;
}

/** Soft-deletes a file or folder by Drive id. NEVER touches the root row —
 *  it's the source of truth for the connection scope and must outlive any
 *  individual sync run. */
async function markDeleted(
  svc: ReturnType<typeof serviceClient>,
  driveId: string,
  counts: Counts,
): Promise<void> {
  const now = new Date().toISOString();
  const { data: folder } = await svc
    .from("folders")
    .update({ deleted_at: now })
    .eq("drive_file_id", driveId)
    .is("deleted_at", null)
    .neq("is_root", true) // defense in depth — never soft-delete the company root
    .select("id");
  const { data: file } = await svc
    .from("files")
    .update({ deleted_at: now })
    .eq("drive_file_id", driveId)
    .is("deleted_at", null)
    .select("id");
  if ((folder && folder.length) || (file && file.length)) counts.removed++;
}

/**
 * Hard-deletes a file or folder by Drive id. Used when Drive reports the item
 * as permanently removed (Super Admin emptied Drive Trash, or Drive's 30-day
 * auto-purge fired). FK cascades (on delete cascade in 0001_schema.sql) clean
 * up permission_grants, folder_assignees, and child folders/files.
 *
 * Never touches the root row.
 */
async function purgeFromCache(
  svc: ReturnType<typeof serviceClient>,
  driveId: string,
  counts: Counts,
): Promise<void> {
  const { data: folder } = await svc
    .from("folders")
    .delete()
    .eq("drive_file_id", driveId)
    .neq("is_root", true)
    .select("id");
  const { data: file } = await svc
    .from("files")
    .delete()
    .eq("drive_file_id", driveId)
    .select("id");
  if ((folder && folder.length) || (file && file.length)) counts.removed++;
}

/** Walks Drive parents to confirm an id sits under the root (incremental path). */
async function isWithinRoot(
  svc: ReturnType<typeof serviceClient>,
  parentDriveId: string,
  rootId: string,
  accessToken: string,
): Promise<boolean> {
  if (parentDriveId === rootId) return true;
  // Fast path: parent already cached as a folder under the root.
  const cached = await localFolderId(svc, parentDriveId);
  if (cached) return true;
  // Fallback: ask Drive for the parent chain (bounded).
  let cursor = parentDriveId;
  let guard = 0;
  while (guard++ < 64) {
    try {
      const file = await getFile(accessToken, cursor);
      const parents = file.parents ?? [];
      if (parents.includes(rootId) || cursor === rootId) return true;
      if (parents.length === 0) return false;
      cursor = parents[0];
    } catch {
      return false;
    }
  }
  return false;
}
