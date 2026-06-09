// Server-only helper: forwards a request from a BFF route to a Supabase
// Edge Function using the caller's cookie session JWT.
//
// Why this exists: the browser must never call Edge Functions directly (we
// don't want to wire JWT plumbing into the client bundle). Instead, the
// browser hits /api/admin/<area>/<action>, and the BFF route uses this helper
// to relay the call to /functions/v1/<function-name> with the user's access
// token in the Authorization header. The Edge Function's auth.ts then
// re-verifies the JWT and re-loads the app_user.

import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from "@/lib/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CallEdgeOptions {
  /** Supabase Edge Function slug (e.g. "drive-oauth-start"). */
  name: string;
  /** HTTP method. Defaults to GET. */
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Optional JSON body for POST/PATCH. */
  body?: unknown;
}

export interface CallEdgeResult<T = unknown> {
  status: number;
  data: T | null;
  error: string | null;
}

/**
 * Resolves the current cookie session's access token, then calls the named
 * Edge Function with it. Returns a normalized result so callers don't have
 * to repeat the same error-handling boilerplate.
 */
export async function callEdgeFunction<T = unknown>(
  options: CallEdgeOptions,
): Promise<CallEdgeResult<T>> {
  if (!FUNCTIONS_URL) {
    return { status: 500, data: null, error: "Supabase URL not configured" };
  }

  const supabase = createSupabaseServerClient();
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) {
    return { status: 401, data: null, error: "Not signed in" };
  }

  const method = options.method ?? "GET";
  const url = `${FUNCTIONS_URL}/${options.name}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: SUPABASE_ANON_KEY,
  };
  let body: BodyInit | undefined;
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(options.body);
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, cache: "no-store" });
  } catch (e) {
    return { status: 502, data: null, error: (e as Error).message || "Network error" };
  }

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // Edge Functions normally return JSON. If they don't, leave parsed as null.
  }

  if (!res.ok) {
    const msg = (parsed as { error?: string } | null)?.error
      ?? `Edge Function "${options.name}" failed (${res.status})`;
    return { status: res.status, data: null, error: msg };
  }

  return { status: res.status, data: parsed as T, error: null };
}
