"use client";

// React Query hooks for the signed-in user's own profile.
//
// Every authenticated role uses these (super_admin through team_member). The
// BFF routes /api/me/profile and /api/me/password do the auth + write.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface MyProfile {
  id: string;
  name: string;
  /** Login email (immutable here). */
  email: string;
  /** Google account email used for Drive sharing. May be null until set. */
  googleEmail: string | null;
  role: string;
  departmentId: string | null;
  departmentName: string;
  avatar: string;
  status: string;
}

export const profileQueryKeys = {
  me: ["me", "profile"] as const,
};

async function asJson<T>(res: Response, fallback: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallback} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchMyProfile(): Promise<MyProfile> {
  const res = await fetch("/api/me/profile", { cache: "no-store" });
  const data = await asJson<{ profile: MyProfile }>(res, "Failed to load profile");
  return data.profile;
}

export interface UpdateProfileInput {
  name?: string;
  googleEmail?: string | null;
}

async function patchProfile(input: UpdateProfileInput): Promise<MyProfile> {
  const res = await fetch("/api/me/profile", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await asJson<{ profile: MyProfile }>(res, "Failed to update profile");
  return data.profile;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

async function postChangePassword(input: ChangePasswordInput): Promise<{ ok: true }> {
  const res = await fetch("/api/me/password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return asJson(res, "Failed to update password");
}

// ─── Hooks ───────────────────────────────────────────────────────────────────
export function useMyProfile() {
  return useQuery({
    queryKey: profileQueryKeys.me,
    queryFn: fetchMyProfile,
    staleTime: 30_000,
  });
}

export function useUpdateProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchProfile,
    onSuccess: (fresh) => {
      qc.setQueryData(profileQueryKeys.me, fresh);
      // The user directory also surfaces googleEmail (so Manage Access can warn);
      // bust that cache so it reflects the change without a manual reload.
      qc.invalidateQueries({ queryKey: ["users"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: postChangePassword,
  });
}
