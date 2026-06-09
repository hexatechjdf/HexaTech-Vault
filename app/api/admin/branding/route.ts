// /api/admin/branding
//
// GET   — any active authenticated user. Returns the singleton branding row.
// PATCH — super_admin only. Updates any subset of company_name, primary_color,
//         accent_color, logo_url. Validates hex colors. Stamps updated_at /
//         updated_by from the cookie session (never trusts the body).
//
// The branding table has a singleton constraint (id boolean primary key
// default true check (id)), so updates always target the same row.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";

export const dynamic = 'force-dynamic';

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

interface BrandingRow {
  company_name: string;
  primary_color: string;
  accent_color: string;
  logo_url: string | null;
  updated_at: string | null;
}

function toDTO(row: BrandingRow) {
  return {
    companyName: row.company_name,
    primaryColor: row.primary_color,
    accentColor: row.accent_color,
    logoUrl: row.logo_url,
    updatedAt: row.updated_at,
  };
}

async function getCaller() {
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return { error: bad("Not signed in", 401) as NextResponse } as const;

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") {
    return { error: bad("Account inactive", 403) as NextResponse } as const;
  }
  return { supabase, caller } as const;
}

// Public GET — the unauthenticated /login page needs to render the logo +
// company name. Branding is intentionally public data; no auth required.
export async function GET() {
  // Use the admin client to side-step RLS (so we don't depend on an
  // authenticated session). Selecting only the safe public columns.
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }
  const { data, error } = await admin
    .from("branding")
    .select("company_name, primary_color, accent_color, logo_url, updated_at")
    .eq("id", true)
    .maybeSingle();
  if (error || !data) return bad("Failed to load branding", 500);

  return NextResponse.json({ branding: toDTO(data) });
}

interface PatchBody {
  companyName?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string | null;
}

export async function PATCH(req: Request) {
  const ctx = await getCaller();
  if ("error" in ctx) return ctx.error;
  const { caller } = ctx;
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return bad("Invalid JSON body");
  }

  const updates: Record<string, unknown> = {};

  if (body.companyName !== undefined) {
    const name = String(body.companyName).trim();
    if (!name) return bad("Company name cannot be empty", 422);
    if (name.length > 200) return bad("Company name too long", 422);
    updates.company_name = name;
  }
  if (body.primaryColor !== undefined) {
    const c = String(body.primaryColor).trim();
    if (!HEX.test(c)) return bad("Primary color must be a hex value like #1B2A4A", 422);
    updates.primary_color = c;
  }
  if (body.accentColor !== undefined) {
    const c = String(body.accentColor).trim();
    if (!HEX.test(c)) return bad("Accent color must be a hex value like #C9A84C", 422);
    updates.accent_color = c;
  }
  if (body.logoUrl !== undefined) {
    if (body.logoUrl !== null) {
      const url = String(body.logoUrl).trim();
      if (!/^https?:\/\//.test(url)) return bad("logoUrl must be an http(s) URL or null", 422);
      updates.logo_url = url;
    } else {
      updates.logo_url = null;
    }
  }

  if (Object.keys(updates).length === 0) return bad("No updates provided", 422);

  updates.updated_at = new Date().toISOString();
  updates.updated_by = caller.id;

  // Use admin client for the write so we don't fight RLS (we've already
  // verified super_admin above).
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const { data, error } = await admin
    .from("branding")
    .update(updates)
    .eq("id", true)
    .select("company_name, primary_color, accent_color, logo_url, updated_at")
    .single();
  if (error || !data) return bad(error?.message ?? "Failed to update branding", 500);

  // Audit.
  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "admin.branding_update",
    resource_type: "branding",
    resource_id: null,
    details: updates,
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  return NextResponse.json({ branding: toDTO(data) });
}
