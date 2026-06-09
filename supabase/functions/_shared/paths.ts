// Materialized path helpers (item 03). folders.path looks like
// '/HexaTech Vault/Development/projX' so subtree queries and breadcrumbs are cheap.

import { serviceClient } from "./supabase.ts";

/** Computes the materialized path for a new child given its parent folder id. */
export async function childPath(parentId: string, name: string): Promise<string> {
  const { data: parent } = await serviceClient()
    .from("folders")
    .select("path, name")
    .eq("id", parentId)
    .maybeSingle();
  const base = parent?.path ?? (parent?.name ? `/${parent.name}` : "");
  // Normalize: avoid trailing slash, escape nothing (display only).
  return `${base.replace(/\/$/, "")}/${name}`;
}
