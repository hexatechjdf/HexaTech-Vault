import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { BACKEND_MODE } from "@/lib/config";
import type { AppUser } from "@/lib/types";
import { AppShell } from "./AppShell";

/**
 * (app) group layout — SERVER COMPONENT.
 *
 * In SUPABASE mode it resolves the authenticated app_user from the cookie session once,
 * then passes it as `initialUser` to the client <AppShell>. This avoids a client-side
 * hydration roundtrip and keeps the service-role usage off the client.
 *
 * In MOCK mode it passes null and the client AuthProvider restores from localStorage.
 *
 * Real route gating lives in middleware.ts. This server-side check is the second line
 * of defence (handles cases where the user was deactivated between requests).
 */
export default async function AppGroupLayout({ children }: { children: React.ReactNode }) {
  let initialUser: AppUser | null = null;

  if (BACKEND_MODE === "supabase") {
    const supabase = createSupabaseServerClient();
    const { data: { user: authUser } } = await supabase.auth.getUser();

    if (!authUser) {
      // Middleware should have already redirected; this catches anything that slipped through.
      redirect("/login");
    }

    const { data: profile } = await supabase
      .from("app_users")
      .select("id, name, email, role, department_id, avatar, status, departments(name)")
      .eq("id", authUser.id)
      .maybeSingle();

    if (!profile) {
      // Auth user exists but no app_users row. Bootstrap wasn't run for this user.
      await supabase.auth.signOut();
      redirect("/login?error=no_profile");
    }

    if (profile.status !== "active") {
      await supabase.auth.signOut();
      redirect("/login?error=inactive");
    }

    const dept = Array.isArray(profile.departments) ? profile.departments[0] : profile.departments;
    initialUser = {
      id: profile.id,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      departmentId: profile.department_id ?? "",
      departmentName: (dept as { name?: string } | null)?.name ?? "",
      avatar: profile.avatar ?? (profile.name ?? "").slice(0, 2).toUpperCase(),
      status: profile.status,
    };
  }

  return <AppShell initialUser={initialUser}>{children}</AppShell>;
}
