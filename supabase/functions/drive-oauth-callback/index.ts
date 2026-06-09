// drive-oauth-callback (items 01 + 03) — GET, browser redirect target.
// Google redirects the super_admin's browser here with ?code & ?state.
//
// Steps: validate state -> exchange code -> require refresh_token ->
// encrypt + UPSERT refresh token into drive_connection and access token into
// drive_tokens -> fetch account email -> find-or-create company root folder
// (reuses on reconnect to the same Google account; creates on first connect
// or when switching to a different Google identity) -> upsert root folders
// row -> audit -> redirect back to the app with ?drive=connected.
//
// This function handles BOTH first-connect and re-connect — the same code
// path replaces a previous connection because the upsert flips the singleton
// row's contents.
//
// This function does NOT return JSON to a fetch() caller; it 302-redirects the
// browser. It never exposes any Google token.

import { corsHeaders } from "../_shared/cors.ts";
import { verifyState } from "../_shared/crypto.ts";
import { serviceClient, requireEnv } from "../_shared/supabase.ts";
import { encrypt } from "../_shared/crypto.ts";
import {
  exchangeCodeForTokens,
  about,
  findOrCreateRootFolder,
} from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

function redirect(to: string): Response {
  return new Response(null, {
    status: 302,
    headers: { ...corsHeaders, Location: to },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const appUrl = Deno.env.get("APP_REDIRECT_URL") ?? "/";
  const ok = (q: string) => redirect(`${appUrl}?drive=${q}`);

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const errParam = url.searchParams.get("error");

    // User cancelled consent.
    if (errParam || !code) {
      return ok("cancelled");
    }
    if (!state) return ok("error");

    // Validate the signed state and recover the initiating super_admin id.
    let superAdminId: string;
    try {
      superAdminId = await verifyState(state);
    } catch {
      return ok("invalid_state");
    }

    const svc = serviceClient();

    // Exchange the authorization code for tokens.
    const tokens = await exchangeCodeForTokens(code);

    // A refresh token is REQUIRED — never persist a connection without one.
    if (!tokens.refresh_token) {
      await writeAudit({
        actorId: superAdminId,
        action: "drive.connect",
        resourceType: "connection",
        result: "failure",
        details: { reason: "no_refresh_token" },
        ipAddress: clientIp(req),
      });
      return ok("no_refresh_token");
    }

    // Resolve the connected account email.
    let accountEmail: string | null = null;
    try {
      const info = await about(tokens.access_token);
      accountEmail = info.user?.emailAddress ?? null;
    } catch {
      accountEmail = null; // non-fatal
    }

    // Find or create the company root folder (item 03).
    const rootName = Deno.env.get("COMPANY_ROOT_NAME") ?? "HexaTech Vault";
    const root = await findOrCreateRootFolder(tokens.access_token, rootName);

    // Encrypt the refresh token (AES-256-GCM).
    const encRefresh = await encrypt(tokens.refresh_token);
    const expiry = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

    // Persist the singleton connection. Upsert so re-connect overwrites the
    // previous row (the immutability trigger was removed in migration 0007).
    // `locked` stays false so a future reconnect can do the same.
    const { error: connErr } = await svc.from("drive_connection").upsert(
      {
        id: true,
        connected_by: superAdminId,
        google_account_email: accountEmail,
        root_folder_id: root.id,
        root_folder_name: root.name,
        refresh_token_encrypted: encRefresh,
        status: "connected",
        locked: false,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (connErr) {
      console.error("drive-oauth-callback upsert failed:", connErr);
      return ok("error");
    }

    // Persist the rotating access token to drive_tokens (NOT the locked row).
    await svc.from("drive_tokens").upsert({
      id: true,
      access_token: tokens.access_token,
      token_expiry: expiry,
      refresh_token_encrypted: encRefresh, // mirror for refresh convenience
      updated_at: new Date().toISOString(),
    });

    // Upsert the root folders row (is_root, parent_id=null).
    await svc.from("folders").upsert(
      {
        drive_file_id: root.id,
        name: root.name,
        parent_id: null,
        is_root: true,
        path: `/${root.name}`,
        created_by: superAdminId,
      },
      { onConflict: "drive_file_id" },
    );

    await writeAudit({
      actorId: superAdminId,
      action: "drive.connect",
      resourceType: "connection",
      resourceId: root.id,
      result: "success",
      details: { accountEmail, rootFolderName: root.name },
      ipAddress: clientIp(req),
    });

    return ok("connected");
  } catch (e) {
    console.error("drive-oauth-callback error:", e);
    return redirect(`${appUrl}?drive=error`);
  }
});
