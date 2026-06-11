"use client";

// React Query hooks for per-folder permission grants.
//
// All calls go through the Next BFF → permissions-set / permissions-get
// Edge Functions, which carry the Drive-native sharing logic. The browser
// only ever sees the shaped DTOs.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantDTO, PermLevel, PrincipalType } from "@/lib/types";
import { userQueryKeys } from "@/lib/queries/users";

export const permissionsQueryKeys = {
  byFolder: (folderId: string | null | undefined) => ["folder-permissions", folderId ?? null] as const,
  all: ["folder-permissions"] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchPermissions(folderId: string): Promise<GrantDTO[]> {
  const res = await fetch(`/api/admin/folders/${folderId}/permissions`, { cache: "no-store" });
  const data = await asJson<{ grants: GrantDTO[] }>(res, "Failed to load permissions");
  return data.grants;
}

export interface SetPermissionInput {
  folderId: string;
  principalType: PrincipalType;
  principalId: string;
  /**
   * Department scope for role grants (migration 0021). Omit/null = unscoped
   * ("all departments"). Must be null/undefined for user grants.
   */
  principalDeptId?: string | null;
  level: PermLevel;
  expiresAt?: string | null;
}

async function postPermission(input: SetPermissionInput): Promise<{ ok: true; grantId?: string; drivePermissionId?: string | null }> {
  const { folderId, ...body } = input;
  const res = await fetch(`/api/admin/folders/${folderId}/permissions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return asJson(res, "Failed to update permission");
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

/** Loads all grants on a folder. Requires manage_access (or super_admin). */
export function useFolderPermissions(folderId: string | null | undefined) {
  return useQuery({
    queryKey: permissionsQueryKeys.byFolder(folderId),
    queryFn: () => fetchPermissions(folderId as string),
    enabled: !!folderId,
    staleTime: 15_000,
  });
}

/** Upserts a grant (also mirrors to Drive when principalType === "user"). */
export function useSetPermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postPermission,
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: permissionsQueryKeys.byFolder(variables.folderId) });
      // Keep the FolderAccessControl tree view in sync after any grant change.
      qc.invalidateQueries({ queryKey: accessTreeQueryKeys.all });
      // The User Management list embeds per-user permission summaries; a role
      // grant change here may shift "inherited" rows for every user holding
      // that role. Bust the cache so the next render reflects reality.
      qc.invalidateQueries({ queryKey: userQueryKeys.users });
    },
  });
}

/**
 * Convenience: revoke a grant by setting level to "no_access".
 * The Edge Function handles the Drive permission deletion.
 */
export function useRevokePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetPermissionInput, "level">) =>
      postPermission({ ...input, level: "no_access" }),
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: permissionsQueryKeys.byFolder(variables.folderId) });
      // The access-tree view aggregates grants for ALL folders, so any single
      // grant change invalidates it too.
      qc.invalidateQueries({ queryKey: accessTreeQueryKeys.all });
      // User Management embeds per-user grant lists — bust it so the inline
      // permissions dropdown reflects the revoke.
      qc.invalidateQueries({ queryKey: userQueryKeys.users });
    },
  });
}

// ─── Access tree (FolderAccessControl batch endpoint) ───────────────────────
//
// Single-fetch source of truth for the Folder Access Control screen. Replaces
// the previous N-call pattern (drive-list per folder + permissions-get per
// folder) with one request to /api/admin/folders/access-tree.

export interface AccessTreeFolder {
  id: string;
  name: string;
  parent_id: string | null;
  is_root: boolean;
  path: string | null;
}

export interface AccessTreeGrant {
  id: string;
  folderId: string;
  principalType: "user" | "role";
  principalId: string;
  /** Department scope for role grants (null = all departments). */
  principalDeptId: string | null;
  level: PermLevel;
  expiresAt: string | null;
}

export interface AccessTree {
  folders: AccessTreeFolder[];
  grants: AccessTreeGrant[];
}

export const accessTreeQueryKeys = {
  all: ["access-tree"] as const,
};

async function fetchAccessTree(): Promise<AccessTree> {
  const res = await fetch("/api/admin/folders/access-tree", { cache: "no-store" });
  return asJson<AccessTree>(res, "Failed to load folder access tree");
}

/**
 * Loads the full folder tree + every active grant in one request.
 * Super-Admin only on the BFF; the hook returns the 403 error otherwise.
 *
 * Cached for 30s — invalidated by useSetPermission / useRevokePermission so
 * grant edits inside FolderAccessControl reflect immediately.
 */
export function useAccessTree() {
  return useQuery({
    queryKey: accessTreeQueryKeys.all,
    queryFn: fetchAccessTree,
    staleTime: 30_000,
  });
}
