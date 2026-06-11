"use client";

// /tabs — Tab Access Control screen.
//
// Hardcoded super-admin gate: this screen is the bootstrap point for the
// entire tab permission system, so we don't gate it BY a tab grant (chicken
// and egg). Anyone else lands on dashboard.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { TabAccessControl } from "@/components/TabAccessControl";

export default function TabsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login"); return; }
    if (user.role !== "super_admin") { router.replace("/dashboard"); return; }
  }, [user, loading, router]);

  if (loading || !user || user.role !== "super_admin") {
    return (
      <div style={{ padding: "32px", fontFamily: "'Poppins', sans-serif", color: "#9ca3af" }}>
        Loading…
      </div>
    );
  }

  return <TabAccessControl />;
}
