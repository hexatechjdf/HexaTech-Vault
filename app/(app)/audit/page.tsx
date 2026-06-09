"use client";

import { useAuth } from "@/lib/auth";
import { AuditLogs } from "@/components/AuditLogs";

export default function AuditPage() {
  const { user } = useAuth();
  if (!user) return null;

  // Admins view their own department's logs in read-only mode (matches App.tsx behaviour).
  const readOnly = user.role === "admin";
  const department = user.role === "admin" ? user.departmentName : undefined;

  return <AuditLogs readOnly={readOnly} department={department} />;
}
