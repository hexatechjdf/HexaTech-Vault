"use client";

// React Query hooks for the Google Drive connection (Settings → Google Drive).
//
// Architecture: browser → Next BFF (/api/admin/drive/*) → Supabase Edge
// Function (Drive logic + Google credentials). The browser never touches
// Drive or Google tokens directly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface DriveStatus {
  connected: boolean;
  accountEmail: string | null;
  rootFolderName: string | null;
  /** ISO 8601 (UTC). */
  connectedAt: string | null;
  /** ISO 8601 (UTC) of the most recent successful sync, if any. */
  lastSyncAt: string | null;
}

export interface VerifyResult {
  ok: boolean;
  reason?: "not_connected" | "token_revoked" | "root_missing" | "drive_error";
  accountEmail?: string | null;
  rootFolderName?: string | null;
}

export const driveQueryKeys = {
  status: ["drive-status"] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchStatus(): Promise<DriveStatus> {
  const res = await fetch("/api/admin/drive/status", { cache: "no-store" });
  return asJson<DriveStatus>(res, "Failed to load Drive status");
}

async function postConnectStart(): Promise<{ url: string }> {
  const res = await fetch("/api/admin/drive/connect-start", { method: "POST" });
  return asJson<{ url: string }>(res, "Failed to start Drive connect");
}

async function postVerify(): Promise<VerifyResult> {
  const res = await fetch("/api/admin/drive/verify", { method: "POST" });
  return asJson<VerifyResult>(res, "Failed to verify Drive");
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────
export function useDriveStatus() {
  return useQuery({
    queryKey: driveQueryKeys.status,
    queryFn: fetchStatus,
    // The status is what the whole Settings → Google Drive panel renders;
    // staleTime keeps consecutive tab visits snappy.
    staleTime: 30_000,
  });
}

export function useStartDriveConnect() {
  return useMutation({
    mutationFn: postConnectStart,
  });
}

export function useVerifyDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postVerify,
    onSuccess: () => {
      // Verify can confirm a reconnect/email change — refresh status so the
      // panel doesn't show stale data.
      qc.invalidateQueries({ queryKey: driveQueryKeys.status });
    },
  });
}
