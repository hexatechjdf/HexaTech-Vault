"use client";

// React Query hooks for per-folder permission grants.
//
// All calls go through the Next BFF → permissions-set / permissions-get
// Edge Functions, which carry the Drive-native sharing logic. The browser
// only ever sees the shaped DTOs.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GrantDTO, PermLevel, PrincipalType } from "@/lib/types";

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
    },
  });
}
