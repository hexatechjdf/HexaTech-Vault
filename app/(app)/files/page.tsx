"use client";

import { useAuth } from "@/lib/auth";
import { FileManager } from "@/components/FileManager";

export default function FilesPage() {
  const { user } = useAuth();
  if (!user) return null;
  return <FileManager role={user.role} />;
}
