// POST /api/admin/branding/logo
//
// Super-admin uploads a new company logo. Accepts multipart/form-data with a
// single `file` field. Validates type & size, writes to the public `branding`
// Storage bucket via the service-role client, then updates branding.logo_url
// with the public URL and returns the fresh branding DTO.
//
// The bucket has a 2 MB file_size_limit + allowed_mime_types whitelist set at
// the bucket level (see migration 0006); we re-check on the BFF for a clean
// error message before the bytes hit Storage.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getClientIp } from "@/lib/server/client-ip";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/svg+xml",
  "image/webp",
]);
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(req: Request) {
  // 1) Identify caller.
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return bad("Not signed in", 401);

  const { data: caller } = await supabase
    .from("app_users")
    .select("id, role, status")
    .eq("id", authUser.id)
    .maybeSingle();
  if (!caller || caller.status !== "active") return bad("Account inactive", 403);
  if (caller.role !== "super_admin") return bad("Super admin only", 403);

  // 2) Parse the multipart body.
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("Expected multipart/form-data with a `file` field", 400);
  }
  const fileEntry = form.get("file");
  if (!(fileEntry instanceof File)) return bad("Missing `file` field", 400);

  if (fileEntry.size === 0) return bad("Empty file", 400);
  if (fileEntry.size > MAX_BYTES) return bad("Logo must be 2 MB or smaller", 413);

  const mime = fileEntry.type || "";
  if (!ALLOWED_MIME.has(mime)) {
    return bad("Logo must be PNG, JPG, SVG, or WebP", 415);
  }
  const ext = MIME_TO_EXT[mime];

  // 3) Upload to Storage via service-role.
  let admin;
  try { admin = createSupabaseAdminClient(); } catch (e) {
    return bad((e as Error).message || "Admin client unavailable", 500);
  }

  const buffer = Buffer.from(await fileEntry.arrayBuffer());
  // Stable random path (so the new URL differs from the cached old one).
  const path = `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { error: uploadErr } = await admin.storage
    .from("branding")
    .upload(path, buffer, {
      contentType: mime,
      upsert: false,
      cacheControl: "3600",
    });
  if (uploadErr) return bad(uploadErr.message || "Upload failed", 500);

  const { data: pub } = admin.storage.from("branding").getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  if (!publicUrl) return bad("Failed to resolve public URL", 500);

  // 4) Persist the URL in branding (and optionally delete the previous logo
  //    file so the bucket doesn't grow unbounded).
  const { data: prev } = await admin
    .from("branding")
    .select("logo_url")
    .eq("id", true)
    .maybeSingle();

  const { data: updated, error: updateErr } = await admin
    .from("branding")
    .update({
      logo_url: publicUrl,
      updated_at: new Date().toISOString(),
      updated_by: caller.id,
    })
    .eq("id", true)
    .select("company_name, primary_color, accent_color, logo_url, updated_at")
    .single();
  if (updateErr || !updated) return bad(updateErr?.message ?? "Failed to save logo URL", 500);

  // Best-effort cleanup of the previous file. Don't fail the request if this errors.
  if (prev?.logo_url && prev.logo_url !== publicUrl) {
    try {
      const prevPath = new URL(prev.logo_url).pathname.split("/storage/v1/object/public/branding/")[1];
      if (prevPath) await admin.storage.from("branding").remove([prevPath]);
    } catch { /* best-effort */ }
  }

  await admin.from("audit_log").insert({
    actor_id: caller.id,
    action: "admin.branding_logo_upload",
    resource_type: "branding",
    resource_id: null,
    details: { logoUrl: publicUrl, size: fileEntry.size, mime },
    result: "success",
    ip_address: getClientIp(req.headers),
  });

  return NextResponse.json({
    branding: {
      companyName: updated.company_name,
      primaryColor: updated.primary_color,
      accentColor: updated.accent_color,
      logoUrl: updated.logo_url,
      updatedAt: updated.updated_at,
    },
  });
}
