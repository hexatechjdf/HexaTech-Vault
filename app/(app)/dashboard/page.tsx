"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { SuperAdminDashboard } from "@/components/SuperAdminDashboard";
import { AdminDashboard } from "@/components/AdminDashboard";
import { ManagerDashboard } from "@/components/ManagerDashboard";
import { TeamLeadDashboard } from "@/components/TeamLeadDashboard";
import type { Screen, User } from "@/lib/types";

/**
 * Dashboard page. The original Vite app's screen-state-machine picked which
 * role-specific dashboard to render; here we do the same but the setScreen
 * callback simply maps onto router.push("/<screen>"). The (app)/layout owns
 * the auth gate, so by the time this renders we always have a user.
 */
export default function DashboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  if (!user) return null;

  const legacyUser: User = {
    name: user.name,
    email: user.email,
    role: user.role,
    department: user.departmentName,
    avatar: user.avatar,
  };

  const setScreen = (s: Screen) => router.push("/" + s);

  switch (user.role) {
    case "super_admin": return <SuperAdminDashboard user={legacyUser} setScreen={setScreen} />;
    case "admin":       return <AdminDashboard user={legacyUser} setScreen={setScreen} />;
    case "manager":     return <ManagerDashboard user={legacyUser} setScreen={setScreen} />;
    default:            return <TeamLeadDashboard user={legacyUser} setScreen={setScreen} />;
  }
}
