"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface LoginActionInput {
  email: string;
  password: string;
  /** Optional path to return to after sign-in (set by middleware when it bounced the user). */
  redirectTo?: string;
}

export interface LoginActionResult {
  error?: string;
}

/**
 * Sign in with email + password via @supabase/ssr.
 *
 * On success this calls `redirect()`, which throws a NEXT_REDIRECT — Next.js catches it
 * and navigates the client. On failure it returns `{ error }` so the form can show it.
 * Cookies are set automatically by the @supabase/ssr server client's cookie jar.
 */
export async function loginAction(input: LoginActionInput): Promise<LoginActionResult> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;

  if (!email || !password) {
    return { error: "Please enter both email and password." };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Don't reveal whether the email or the password was wrong.
    return { error: "Invalid email or password." };
  }

  const safeTarget =
    input.redirectTo && input.redirectTo.startsWith("/") && !input.redirectTo.startsWith("//")
      ? input.redirectTo
      : "/dashboard";

  redirect(safeTarget);
}
