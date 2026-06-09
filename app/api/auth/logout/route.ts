// POST /api/auth/logout — signs the user out, clearing the @supabase/ssr cookies.
// Called by AuthProvider.logout() in supabase mode (lib/auth.tsx). The client then
// navigates to /login; middleware enforces it on subsequent requests.

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const supabase = createSupabaseServerClient();
    await supabase.auth.signOut();
  } catch {
    // If the supabase env isn't configured (mock mode hitting this endpoint), there's
    // nothing to sign out from. Either way the client clears its local state.
  }
  return NextResponse.json({ ok: true });
}
