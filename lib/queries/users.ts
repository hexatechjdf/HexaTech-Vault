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

async function fetchUsers(): Promise<AppUser[]> {
  const res = await fetch("/api/admin/users", { cache: "no-store" });
  const data = await asJson<{ users: AppUser[] }>(res, "Failed to load users");
  return data.users;
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
// Hooks — what components actually use.
// ─────────────────────────────────────────────────────────────────────────────
export function useUsers() {
  return useQuery({
    queryKey: userQueryKeys.users,
    queryFn: fetchUsers,
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
