"use client";

// React Query hooks for Drive folder/file browsing + mutations.
//
// All calls go through the Next BFF (/api/admin/drive/*) → Edge Functions →
// Google Drive. The browser never holds a Google token or talks to Drive
// directly.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FileDTO, FolderDTO, PermLevel, PrincipalType } from "@/lib/types";

export interface ListResult {
  folders: FolderDTO[];
  files: FileDTO[];
  breadcrumb: { id: string; name: string }[];
  /** Caller's effective level on the listed folder, used to gate UI buttons. */
  myLevelHere?: PermLevel;
}

export interface GrantInput {
  principalType: PrincipalType;
  principalId: string;
  level: PermLevel;
}

export interface CreateFolderInput {
  parentFolderId: string;
  name: string;
  ownerDepartmentId: string;
  roleContext?: string;
  access?: GrantInput[];
}

export interface UploadFileInput {
  folderId: string;
  name: string;
  mimeType: string;
  contentBase64?: string;
}

export interface DeleteItemInput {
  id: string;
  kind: "folder" | "file";
}

// Recovery (Trash) DTOs - returned by GET /api/admin/drive/trash.
export interface TrashItem {
  id: string;
  driveFileId: string;
  kind: "folder" | "file";
  name: string;
  path: string | null;
  deletedAt: string;
}

export interface TrashList {
  items: TrashItem[];
  retentionDays: number;
}

export interface RestoreItemInput {
  id: string;
  kind: "folder" | "file";
}

export interface PurgeItemInput {
  id: string;
  kind: "folder" | "file";
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  status: "success" | "error";
  finishedAt: string;
}

export interface DownloadResult {
  name: string;
  mimeType: string;
  webViewLink: string | null;
  webContentLink: string | null;
}

// ─── Cache keys ──────────────────────────────────────────────────────────────
export const driveFilesQueryKeys = {
  // Note: undefined folderId = root listing; we serialize it so the cache
  // distinguishes root from explicit folder ids.
  list: (folderId: string | null | undefined) => ["drive-list", folderId ?? null] as const,
  allLists: ["drive-list"] as const,
  trash: ["drive-trash"] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchList(folderId: string | null | undefined): Promise<ListResult> {
  const res = await fetch("/api/admin/drive/list", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId: folderId ?? null }),
  });
  return asJson<ListResult>(res, "Failed to load folder");
}

async function postCreateFolder(input: CreateFolderInput): Promise<{ folder: FolderDTO }> {
  const res = await fetch("/api/admin/drive/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...input, access: input.access ?? [] }),
  });
  return asJson<{ folder: FolderDTO }>(res, "Failed to create folder");
}

async function postUploadFile(input: UploadFileInput): Promise<{ file: FileDTO }> {
  const res = await fetch("/api/admin/drive/files/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ file: FileDTO }>(res, "Failed to upload file");
}

async function postDeleteItem(input: DeleteItemInput): Promise<{ ok: true }> {
  const res = await fetch("/api/admin/drive/items/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ ok: true }>(res, "Failed to delete");
}

async function postDownloadLink(fileId: string): Promise<DownloadResult> {
  const res = await fetch("/api/admin/drive/files/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
  });
  return asJson<DownloadResult>(res, "Failed to get download link");
}

async function postSyncNow(): Promise<SyncResult> {
  const res = await fetch("/api/admin/drive/sync", { method: "POST" });
  return asJson<SyncResult>(res, "Failed to sync");
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Lists folders + files inside `folderId` (or the company root if undefined/null). */
export function useDriveList(folderId: string | null | undefined) {
  return useQuery({
    queryKey: driveFilesQueryKeys.list(folderId),
    queryFn: () => fetchList(folderId),
    staleTime: 30_000,
  });
}

/**
 * Creates a folder. On success, invalidates every drive listing in the cache.
 *
 * Why not just the parent's listing: the root folder is represented as `null`
 * in the list cache key (`["drive-list", null]`) but as its actual UUID in
 * mutation variables (`parentFolderId = "<root-uuid>"`). A narrow invalidate
 * misses the loaded root view, so the new folder doesn't show up until a hard
 * reload. Invalidating all drive-list queries is the simple, always-correct
 * fix and matches what useDeleteItem already does.
 */
export function useCreateFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCreateFolder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
    },
  });
}

/** Uploads a (small, base64-encoded) file. Invalidates every drive listing. */
export function useUploadFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postUploadFile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
    },
  });
}

/**
 * Trashes a folder or file. We don't know the affected listing key for sure
 * (deleting a file affects its parent; deleting a folder affects the parent
 * of the deleted folder), so we just invalidate all `drive-list` queries.
 * That's overkill but always correct.
 */
export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postDeleteItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
    },
  });
}

/** Asks the BFF for a fresh Drive download link. */
export function useDownloadLink() {
  return useMutation({
    mutationFn: postDownloadLink,
  });
}

async function fetchMyFolders(): Promise<FolderDTO[]> {
  const res = await fetch("/api/admin/drive/my-folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const data = await asJson<{ folders: FolderDTO[] }>(res, "Failed to load your folders");
  return data.folders;
}

/**
 * Entry point for users who can't see the company root. Lists every folder
 * the caller has been granted access to. `enabled` lets the caller gate the
 * fetch — we only want to hit this endpoint when drive-list at root failed.
 */
export function useMyFolders(enabled: boolean) {
  return useQuery({
    queryKey: ["my-folders"] as const,
    queryFn: fetchMyFolders,
    enabled,
    staleTime: 30_000,
  });
}

/** Forces a Drive→DB sync and invalidates all listings on success. */
export function useSyncNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postSyncNow,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.trash });
    },
  });
}

// ─── Trash / Recovery ────────────────────────────────────────────────────────

async function fetchTrash(): Promise<TrashList> {
  const res = await fetch("/api/admin/drive/trash", { cache: "no-store" });
  return asJson<TrashList>(res, "Failed to load Trash");
}

async function postRestoreItem(input: RestoreItemInput): Promise<{ ok: true }> {
  const res = await fetch("/api/admin/drive/items/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ ok: true }>(res, "Failed to restore");
}

async function postPurgeItem(input: PurgeItemInput): Promise<{ ok: true }> {
  const res = await fetch("/api/admin/drive/items/purge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ ok: true }>(res, "Failed to permanently delete");
}

/**
 * Lists every soft-deleted folder and file currently within the recovery
 * window. Super-Admin only on the BFF; the hook is harmless if a non-super
 * mounts it (the fetch just 403s).
 *
 * `enabled` lets callers gate the fetch (the Trash view only mounts when the
 * super admin opens the Trash tab).
 */
export function useTrash(enabled: boolean) {
  return useQuery({
    queryKey: driveFilesQueryKeys.trash,
    queryFn: fetchTrash,
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Restores a soft-deleted folder or file. Invalidates both the Trash list
 * (so the row disappears from it) and every drive-list (so the restored
 * item reappears in its original location).
 */
export function useRestoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postRestoreItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.trash });
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
    },
  });
}

/**
 * Permanently deletes a soft-deleted folder or file - removes from Drive AND
 * hard-deletes the DB row. Invalidates the Trash list so the row disappears.
 * No drive-list invalidation needed (the item was already hidden from those
 * views via deleted_at).
 */
export function usePurgeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postPurgeItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.trash });
    },
  });
}

// ─── Proposal clone ─────────────────────────────────────────────────────────

export interface CloneProposalInput {
  /** DB id of the sample file being cloned. */
  sourceFileId: string;
  /** End-client / customer name for the new project. */
  clientName: string;
  /** Project / engagement title. */
  projectTitle: string;
}

export interface ClonedProposalResult {
  ok: true;
  folder: {
    id: string;
    driveFileId: string;
    name: string;
    parentId: string;
  };
  file: {
    id: string;
    driveFileId: string;
    name: string;
    mimeType: string | null;
    webViewLink: string | null;
  };
}

async function postCloneProposal(input: CloneProposalInput): Promise<ClonedProposalResult> {
  const res = await fetch("/api/admin/drive/proposals/clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<ClonedProposalResult>(res, "Failed to clone proposal");
}

/**
 * Clones a sample proposal file into a brand-new project folder.
 * On success invalidates every drive listing so the new project folder
 * appears immediately inside the Proposal folder.
 */
export function useCloneProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCloneProposal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: driveFilesQueryKeys.allLists });
    },
  });
}
