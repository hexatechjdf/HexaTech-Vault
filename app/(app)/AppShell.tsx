"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Layout } from "@/components/Layout";
import type { AppUser, User } from "@/lib/types";

/**
 * Client shell wrapped by the server-component (app) layout. Receives `initialUser`
 * pre-resolved from the cookie session (supabase mode) or `null` (mock mode, where
 * AuthProvider restores from localStorage).
 */
function ShellInner({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  // Soft client-side guard for mock mode (where there's no server-side gate).
  // In supabase mode the server layout + middleware already redirected.
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Poppins', sans-serif", color: "#9ca3af" }}>
        Loading…
      </div>
    );
  }
  if (!user) return null;

  const legacyUser: User = {
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.departmentName,
    avatar: user.avatar,
  };

  const handleLogout = async () => {
    await logout();
    router.push("/login");
  };

  return (
    <Layout user={legacyUser} onLogout={handleLogout}>
      {children}
    </Layout>
  );
}

export function AppShell({ initialUser, children }: { initialUser: AppUser | null; children: React.ReactNode }) {
  return (
    <AuthProvider initialUser={initialUser}>
      <ShellInner>{children}</ShellInner>
    </AuthProvider>
  );
}
