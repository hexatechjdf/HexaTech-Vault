"use client";

// React Query hooks for the Backup engine (Settings → Backup).
//
// Architecture: browser → Next BFF (/api/admin/backup/*) → backup-run Edge
// Function. Same shape as the Drive Connection hooks.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export type BackupFrequency = "daily" | "weekly" | "monthly";

export interface BackupConfig {
  enabled: boolean;
  frequency: BackupFrequency;
  retentionDays: number;
  bucket: string;
  updatedAt: string | null;
}

export interface BackupRun {
  id: string;
  /** ISO 8601 (UTC). */
  startedAt: string;
  /** ISO 8601 (UTC); null while running. */
  finishedAt: string | null;
  status: "running" | "success" | "failed";
  bytes: number | null;
  objectPath: string | null;
  error: string | null;
  triggeredBy: "cron" | "manual";
}

export interface RunBackupResult {
  ok: boolean;
  runId: string;
  bytes?: number;
  objectPath?: string;
  error?: string;
  skipped?: boolean;
  reason?: string;
}

export const backupQueryKeys = {
  config: ["backup-config"] as const,
  runs: (limit: number) => ["backup-runs", { limit }] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

async function fetchConfig(): Promise<BackupConfig> {
  const res = await fetch("/api/admin/backup/config", { cache: "no-store" });
  return asJson<BackupConfig>(res, "Failed to load backup config");
}

export function useBackupConfig() {
  return useQuery({
    queryKey: backupQueryKeys.config,
    queryFn: fetchConfig,
    staleTime: 30_000,
  });
}

export interface UpdateBackupConfigInput {
  enabled?: boolean;
  frequency?: BackupFrequency;
  retentionDays?: number;
}

async function putConfig(input: UpdateBackupConfigInput): Promise<BackupConfig> {
  const res = await fetch("/api/admin/backup/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<BackupConfig>(res, "Failed to update backup config");
}

export function useUpdateBackupConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: putConfig,
    onSuccess: (fresh) => {
      // Replace the cached config so callers re-render with the new values
      // without a refetch round-trip.
      qc.setQueryData(backupQueryKeys.config, fresh);
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Runs
// ─────────────────────────────────────────────────────────────────────────────

async function fetchRuns(limit: number): Promise<BackupRun[]> {
  const res = await fetch(`/api/admin/backup/runs?limit=${limit}`, { cache: "no-store" });
  const data = await asJson<{ runs: BackupRun[] }>(res, "Failed to load backup runs");
  return data.runs;
}

export function useBackupRuns(limit = 20) {
  return useQuery({
    queryKey: backupQueryKeys.runs(limit),
    queryFn: () => fetchRuns(limit),
    staleTime: 10_000,
  });
}

async function postRunNow(): Promise<RunBackupResult> {
  const res = await fetch("/api/admin/backup/run", { method: "POST" });
  return asJson<RunBackupResult>(res, "Failed to start backup");
}

export function useRunBackupNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postRunNow,
    onSuccess: () => {
      // Manual run produces a new row; invalidate every run-list cache key.
      qc.invalidateQueries({ queryKey: ["backup-runs"] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Download
// ─────────────────────────────────────────────────────────────────────────────

async function fetchSignedDownloadUrl(runId: string): Promise<string> {
  const res = await fetch(`/api/admin/backup/runs/${encodeURIComponent(runId)}/download`, {
    cache: "no-store",
  });
  const data = await asJson<{ url: string }>(res, "Failed to sign download URL");
  return data.url;
}

export function useBackupDownloadUrl() {
  return useMutation({
    mutationFn: fetchSignedDownloadUrl,
  });
}
