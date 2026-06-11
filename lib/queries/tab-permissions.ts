"use client";

// React Query hooks for the Tab Permission system.
//
// (super_admin is treated as having 'action' on every tab unconditionally,
// without waiting for any network call — see useCanAct below.)
//
//   useTabGrants()        - Super-admin only. Returns every grant for the
//                           Tab Access Control matrix.
//   useSetTabGrant()      - Super-admin only. Upserts or deletes a single
//                           grant. Mirrors the mutation contract of the
//                           folder permissions hook.
//   useMyTabAccess()      - Any signed-in user. Returns the caller's
//                           effective level on each of the 6 tabs. Cached
//                           generously and refreshed on login.
//
// All calls go through the BFF — the browser never hits the Edge Functions
// directly. The BFF re-verifies the cookie session.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TabName, TabLevel } from "@/lib/tabs";
import { useAuth } from "@/lib/auth";
import { userQueryKeys } from "@/lib/queries/users";

// ─── Types ──────────────────────────────────────────────────────────────────
export interface TabGrant {
  id: string;
  tab: TabName;
  principalType: "user" | "role";
  principalId: string;
  principalDeptId: string | null;
  departmentName: string | null;
  level: TabLevel;
  grantedBy: string | null;
  grantedAt: string;
}

export interface SetTabGrantInput {
  tab: TabName;
  principalType: "user" | "role";
  principalId: string;
  /** Optional. Only valid for role grants. */
  principalDeptId?: string | null;
  level: TabLevel;
  /** Force-keep an explicit no_access USER grant (overrides inheritance). */
  keepExplicit?: boolean;
}

export type MyTabAccess = Record<TabName, TabLevel>;

// ─── Query keys ─────────────────────────────────────────────────────────────
export const tabPermissionQueryKeys = {
  grants: ["tab-permissions", "grants"] as const,
  myAccess: ["tab-permissions", "me"] as const,
};

// ─── Fetchers ───────────────────────────────────────────────────────────────
async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchTabGrants(): Promise<TabGrant[]> {
  const res = await fetch("/api/admin/tabs/permissions", { cache: "no-store" });
  const data = await asJson<{ grants: TabGrant[] }>(res, "Failed to load tab grants");
  return data.grants;
}

async function postSetTabGrant(input: SetTabGrantInput): Promise<{ ok: true }> {
  const res = await fetch("/api/admin/tabs/permissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson<{ ok: true }>(res, "Failed to update tab grant");
}

async function fetchMyTabAccess(): Promise<MyTabAccess> {
  const res = await fetch("/api/admin/tabs/me", { cache: "no-store" });
  const data = await asJson<{ tabs: MyTabAccess }>(res, "Failed to load tab access");
  return data.tabs;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────
/** Super-admin only. Powers the Tab Access Control matrix. */
export function useTabGrants(enabled: boolean) {
  return useQuery({
    queryKey: tabPermissionQueryKeys.grants,
    queryFn: fetchTabGrants,
    enabled,
    staleTime: 30_000,
  });
}

/** Super-admin only. Upsert or delete a grant. */
export function useSetTabGrant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postSetTabGrant,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: tabPermissionQueryKeys.grants });
      // Also bust every caller's "my access" cache — their effective level
      // may have just changed if they're the principal of the grant.
      qc.invalidateQueries({ queryKey: tabPermissionQueryKeys.myAccess });
      // User Management embeds per-user tab grant lists. A role+dept tab
      // grant change shifts inherited rows for every user with that role,
      // so the users query needs a refresh.
      qc.invalidateQueries({ queryKey: userQueryKeys.users });
    },
  });
}

/**
 * Returns the current user's effective level on every tab. Cached for the
 * session (refreshed on focus / refetch). All non-super-admin gating in the
 * app keys off this.
 */
export function useMyTabAccess() {
  return useQuery({
    queryKey: tabPermissionQueryKeys.myAccess,
    queryFn: fetchMyTabAccess,
    staleTime: 60_000,
  });
}

/**
 * Convenience: true if the caller can take ACTIONS in the named tab.
 *   - super_admin -> ALWAYS true. They own the system; no network call is
 *                    even made, so buttons are usable immediately on login
 *                    even before /api/admin/tabs/me resolves.
 *   - others      -> true only when their effective level is 'action'.
 *                    Returns false while the access query is loading so we
 *                    err on the side of disabling, not enabling, something
 *                    we shouldn't.
 *
 * Components use this to disable mutation buttons (Upload, Save, Add User,
 * level dropdowns etc.). The mutation BFF routes ALSO check via
 * requireTabLevel(req, tab, 'action') — the client check is UX, the server
 * check is security.
 */
export function useCanAct(tab: TabName): boolean {
  const { user } = useAuth();
  // Super_admin short-circuit — keep them unblocked even if the access
  // query hasn't finished, fails, or is paused for any reason.
  if (user?.role === "super_admin") return true;
  const { data } = useMyTabAccess();
  return data?.[tab] === "action";
}
