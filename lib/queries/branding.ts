"use client";

// React Query hooks for branding (company info).
//
// All calls go through the Next BFF (/api/admin/branding[/logo]). Browser
// never touches Supabase Storage directly — the BFF service-role client
// handles uploads.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface Branding {
  companyName: string;
  primaryColor: string;
  accentColor: string;
  logoUrl: string | null;
  /** Suffix appended to cloned proposal folder names ("Client - Project - X"). */
  proposalLabel: string;
  updatedAt: string | null;
}

export const brandingQueryKeys = {
  branding: ["branding"] as const,
};

async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`;
    throw new Error(msg);
  }
  return data as T;
}

async function fetchBranding(): Promise<Branding> {
  const res = await fetch("/api/admin/branding", { cache: "no-store" });
  const data = await asJson<{ branding: Branding }>(res, "Failed to load branding");
  return data.branding;
}

export interface UpdateBrandingInput {
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
  proposalLabel?: string;
}

async function patchBranding(input: UpdateBrandingInput): Promise<Branding> {
  const res = await fetch("/api/admin/branding", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await asJson<{ branding: Branding }>(res, "Failed to update branding");
  return data.branding;
}

async function postLogo(file: File): Promise<Branding> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/admin/branding/logo", {
    method: "POST",
    body: form,
  });
  const data = await asJson<{ branding: Branding }>(res, "Failed to upload logo");
  return data.branding;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks
// ─────────────────────────────────────────────────────────────────────────────
export function useBranding() {
  return useQuery({
    queryKey: brandingQueryKeys.branding,
    queryFn: fetchBranding,
    // Branding is read on every screen; cache it generously and let the
    // mutation invalidate it on change.
    staleTime: 5 * 60_000,
  });
}

export function useUpdateBranding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: patchBranding,
    onSuccess: (fresh) => {
      // Write the new value straight into the cache so all consumers
      // (Layout, LoginPage, BrandingApplier) re-render immediately.
      qc.setQueryData(brandingQueryKeys.branding, fresh);
    },
  });
}

export function useUploadLogo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postLogo,
    onSuccess: (fresh) => {
      qc.setQueryData(brandingQueryKeys.branding, fresh);
    },
  });
}
