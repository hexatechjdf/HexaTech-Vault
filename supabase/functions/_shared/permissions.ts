// Permission engine bridge for Edge Functions.
//
// getEffectiveLevel() calls the SQL function get_effective_level() (the single
// source of truth, Foundation §6) via RPC. requirePermission() maps the
// resolved level to the capability matrix and throws HttpError(403) when the
// capability is absent.
//
// Capability matrix (Foundation §6) — keep in lockstep with the SQL/DB:
//
//   Level          see list preview download upload rename move delete subfolder manage
//   no_access       -    -     -       -       -      -     -    -      -         -
//   view            x    x     x       -       -      -     -    -      -         -
//   view_download   x    x     x       x       -      -     -    -      -         -
//   view_upload     x    x     x       x       x      -     -    -      -         -
//   contributor     x    x     x       x       x      x     x    -      x         -
//   full_control    x    x     x       x       x      x     x    x      x         x
//
// Requirement mapping (item 04):
//   create = contributor+ (create_subfolder / upload)
//   update = contributor  (rename / move / edit)
//   delete = full_control
//   manage access = full_control

import { serviceClient } from "./supabase.ts";
import { HttpError } from "./auth.ts";

export type PermLevel =
  | "no_access"
  | "view"
  | "view_download"
  | "view_upload"
  | "contributor"
  | "full_control";

export type Capability =
  | "list" // see/list
  | "preview" // open/preview metadata
  | "download"
  | "upload"
  | "rename" // rename/edit
  | "move"
  | "delete"
  | "create_subfolder"
  | "manage_access";

const LEVEL_RANK: Record<PermLevel, number> = {
  no_access: 0,
  view: 1,
  view_download: 2,
  view_upload: 3,
  contributor: 4,
  full_control: 5,
};

// Capability -> minimum level that grants it (per the matrix above).
const CAPABILITY_MIN_LEVEL: Record<Capability, PermLevel> = {
  list: "view",
  preview: "view",
  download: "view_download",
  upload: "view_upload",
  rename: "contributor",
  move: "contributor",
  create_subfolder: "contributor",
  delete: "full_control",
  manage_access: "full_control",
};

/** True if `level` grants `capability`. */
export function levelHasCapability(level: PermLevel, capability: Capability): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[CAPABILITY_MIN_LEVEL[capability]];
}

export function rankOf(level: PermLevel): number {
  return LEVEL_RANK[level];
}

/** Resolves a user's effective level on a folder (DB id) via the SQL engine. */
export async function getEffectiveLevel(
  userId: string,
  folderId: string,
): Promise<PermLevel> {
  const { data, error } = await serviceClient().rpc("get_effective_level", {
    p_user: userId,
    p_folder: folderId,
  });
  if (error) {
    throw new HttpError(500, `Permission lookup failed: ${error.message}`);
  }
  return (data as PermLevel) ?? "no_access";
}

/**
 * Throws HttpError(403) unless the user's effective level on the folder grants
 * the capability. Returns the resolved level for downstream use.
 */
export async function requirePermission(
  userId: string,
  folderId: string,
  capability: Capability,
): Promise<PermLevel> {
  const level = await getEffectiveLevel(userId, folderId);
  if (!levelHasCapability(level, capability)) {
    throw new HttpError(
      403,
      `Forbidden: '${capability}' requires at least '${CAPABILITY_MIN_LEVEL[capability]}' (you have '${level}')`,
    );
  }
  return level;
}
