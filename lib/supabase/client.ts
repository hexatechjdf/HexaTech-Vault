/**
 * Supabase BROWSER client (for client components, hooks, event handlers).
 *
 * Wired infrastructure — login itself is intentionally NOT implemented yet.
 * See ../../../GETTING_STARTED.md auth plan for the planned flow:
 *   1. Login form posts to a server action.
 *   2. Server action uses `createServerClient` (./server.ts) to call
 *      `auth.signInWithPassword` and sets the session cookies via `cookies()`.
 *   3. Browser code then uses this client only for queries the user is allowed
 *      to make (the session is read from the cookies automatically).
 *
 * Do NOT use this for authentication operations — those belong in server.ts.
 */

import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

export function createSupabaseBrowserClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or switch NEXT_PUBLIC_BACKEND_MODE=mock."
    );
  }
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
