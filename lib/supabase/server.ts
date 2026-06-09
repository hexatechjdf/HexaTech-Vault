/**
 * Supabase SERVER client (for server components, route handlers, server actions).
 *
 * Wired infrastructure — login itself is intentionally NOT implemented yet.
 * See ../../../GETTING_STARTED.md auth plan. Once login is implemented, the flow is:
 *   - server action calls `createSupabaseServerClient().auth.signInWithPassword(...)`
 *   - the session is persisted via the cookie jar created here
 *   - middleware.ts refreshes the session cookie on every request
 *
 * This client reads/writes auth cookies through Next's `cookies()` helper, so it
 * MUST only be called from a server context (RSC, route handler, server action).
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/config";

export function createSupabaseServerClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, or switch NEXT_PUBLIC_BACKEND_MODE=mock."
    );
  }
  const cookieStore = cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // `set` is not allowed inside Server Components rendering output.
          // Route handlers / server actions can set cookies normally; the
          // middleware also refreshes them. Silently ignore in RSC.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          /* see note above */
        }
      },
    },
  });
}
