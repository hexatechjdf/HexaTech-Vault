// Service-role Supabase client factory.
//
// Edge Functions enforce authorization in code (auth -> permission -> root ->
// action -> audit), so they connect with the SERVICE ROLE key which bypasses
// RLS. The service role key is injected by the Supabase runtime and must NEVER
// be shipped to the browser.

import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type { SupabaseClient };

/** Throws if a required environment variable is missing. */
export function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

let _serviceClient: SupabaseClient | null = null;

/** Returns a singleton service-role client (bypasses RLS). */
export function serviceClient(): SupabaseClient {
  if (_serviceClient) return _serviceClient;
  const url = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  _serviceClient = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _serviceClient;
}

/**
 * Returns a client scoped to the caller's JWT. Used only to verify the JWT and
 * read auth.users via getUser(); all privileged DB work uses serviceClient().
 */
export function userScopedClient(authHeader: string): SupabaseClient {
  const url = requireEnv("SUPABASE_URL");
  const anonKey = requireEnv("SUPABASE_ANON_KEY");
  return createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
