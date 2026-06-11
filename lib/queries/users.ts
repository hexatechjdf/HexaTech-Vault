"use client";

// React Query hooks for User Management.
//
// All API calls go through the Next.js BFF (/api/admin/*), NOT directly to
// Supabase Edge Functions. That keeps auth in cookies (no JWT plumbing in
// the browser) and lets us add caching/validation in one place.
//
// Pattern to mirror for future screens:
//   - One `query keys` const at the top (so invalidation is typo-safe).
//   - One async fetch helper per endpoint that throws an Error on non-2xx.
//   - One thin `use<Resource>` hook per endpoint that calls useQuery.
//   - Mutations: useMutation + onSuccess invalidates the relevant query key.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AppUser, Department, Role } from "@/lib/types";

// ─── Per-user permission summary (returned inline by /api/admin/users) ──────
//
// Same row shapes as the /api/admin/users/[id]/effective-access endpoint, but
// embedded directly on each row so the table can show "what does this user
// have" without an N+1 follow-up call per user. Components also re-use these
// rows when opening the "View Access" modal — no separate fetch needed.

export interface UserFolderGrantRow {
  id: string;
  folderId: string;
  folderName: string;
  folderPath: string;
  level: string;
  source: "direct" | "role_dept" | "role_unscoped";
  via: string;
}

export interface UserTabGrantRow {
  id: string;
  tab: string;
  level: string;
  source: "direct" | "role_dept" | "role_unscoped";
  via: string;
}

export interface UserPermissions {
  folders: {
    direct: UserFolderGrantRow[];
    inheritedRoleDept: UserFolderGrantRow[];
    inheritedRoleUnscoped: UserFolderGrantRow[];
  };
  tabs: {
    direct: UserTabGrantRow[];
    inheritedRoleDept: UserTabGrantRow[];
    inheritedRoleUnscoped: UserTabGrantRow[];
  };
}

export interface UserWithPermissions extends AppUser {
  permissions: UserPermissions;
}

export function emptyPermissions(): UserPermissions {
  return {
    folders: { direct: [], inheritedRoleDept: [], inheritedRoleUnscoped: [] },
    tabs: { direct: [], inheritedRoleDept: [], inheritedRoleUnscoped: [] },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Query keys — single source of truth. Use these constants everywhere; never
// inline the strings, or cache invalidation will silently desync.
// ─────────────────────────────────────────────────────────────────────────────
export const userQueryKeys = {
  users: ["users"] as const,
  departments: ["departments"] as const,
};

// ─────────────────────────────────────────────────────────────────────────────
// Fetch helpers — small, no React, easy to test.
// ─────────────────────────────────────────────────────────────────────────────
async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchUsers(): Promise<UserWithPermissions[]> {
  const res = await fetch("/api/admin/users", { cache: "no-store" });
  const data = await asJson<{ users: UserWithPermissions[] }>(res, "Failed to load users");
  // Server now always returns `permissions`, but be defensive against older
  // cached responses so the UI doesn't blow up if a hot-reload races a
  // backend deploy.
  return data.users.map((u) => ({ ...u, permissions: u.permissions ?? emptyPermissions() }));
}

async function fetchDepartments(): Promise<Department[]> {
  const res = await fetch("/api/admin/departments", { cache: "no-store" });
  const data = await asJson<{ departments: Department[] }>(res, "Failed to load departments");
  return data.departments;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  password: string;
  avatar?: string;
}

async function postCreateUser(input: CreateUserInput): Promise<AppUser> {
  const res = await fetch("/api/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await asJson<{ user: AppUser }>(res, "Failed to create user");
  return data.user;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mutations for the row-level actions in User Management (PATCH/DELETE).
// All call /api/admin/users/[id] with a discriminated `action` field on PATCH,
// or DELETE for removal. On success we invalidate the users cache so the table
// reflects the new state. The BFF re-verifies super-admin authorization.
// ─────────────────────────────────────────────────────────────────────────────

async function patchUser(id: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`/api/admin/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await asJson<{ ok: true }>(res, "Failed to update user");
}

export interface UpdateUserProfileInput {
  id: string;
  name?: string;
  avatar?: string;
  googleEmail?: string | null;
}

export interface UpdateUserRoleInput {
  id: string;
  role: Role;
  departmentId: string;
}

export interface UpdateUserStatusInput {
  id: string;
  status: "active" | "inactive";
}

export interface ResetUserPasswordInput {
  id: string;
  password: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks — what components actually use.
// ─────────────────────────────────────────────────────────────────────────────
export function useUsers() {
  return useQuery({
    queryKey: userQueryKeys.users,
    queryFn: fetchUsers,
    // The provider sets a 60s default staleTime and disables refetchOnFocus.
    // For the users list we override both: every page mount and every refocus
    // refetches, so the inline permission chips reflect grant changes made
    // elsewhere (Folder Access Control / Tab Access Control) without the user
    // having to manually hit Refresh.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: userQueryKeys.departments,
    queryFn: fetchDepartments,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCreateUser,
    onSuccess: () => {
      // Refresh the users list once the server confirms the create.
      qc.invalidateQueries({ queryKey: userQueryKeys.users });
    },
  });
}

export function useUpdateUserProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...rest }: UpdateUserProfileInput) =>
      patchUser(id, { action: "update_profile", ...rest }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userQueryKeys.users }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role, departmentId }: UpdateUserRoleInput) =>
      patchUser(id, { action: "update_role", role, departmentId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userQueryKeys.users }),
  });
}

export function useUpdateUserStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: UpdateUserStatusInput) =>
      patchUser(id, { action: "update_status", status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: userQueryKeys.users }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: ResetUserPasswordInput) =>
      patchUser(id, { action: "reset_password", password }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      await asJson<{ ok: true }>(res, "Failed to delete user");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: userQueryKeys.users }),
  });
}

// ─── Effective access (per-user inherited + direct grants) ──────────────────
//
// Same row shapes the list endpoint already embeds — aliased for the existing
// detail-fetch consumers (UserEffectiveAccess) so callers don't have to track
// two parallel types.

export type FolderAccessRow = UserFolderGrantRow;
export type TabAccessRow = UserTabGrantRow;

export interface EffectiveAccessResult {
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    departmentId: string | null;
    departmentName: string | null;
  };
  folders: {
    direct: FolderAccessRow[];
    inheritedRoleDept: FolderAccessRow[];
    inheritedRoleUnscoped: FolderAccessRow[];
  };
  tabs: {
    direct: TabAccessRow[];
    inheritedRoleDept: TabAccessRow[];
    inheritedRoleUnscoped: TabAccessRow[];
  };
}

/**
 * Returns every grant that applies to the given user, split by source.
 * Used by the User Profile (Effective Access) view in both Folder Access
 * Control and User Management.
 */
export function useEffectiveAccess(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["effective-access", userId],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}/effective-access`, { cache: "no-store" });
      return asJson<EffectiveAccessResult>(res, "Failed to load effective access");
    },
    enabled: enabled && !!userId,
    staleTime: 30_000,
  });
}
