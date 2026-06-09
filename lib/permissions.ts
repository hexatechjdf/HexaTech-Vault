// Permission capability matrix + helpers.
// This is the SINGLE source of truth on the frontend for "what does each level allow".
// The Supabase side mirrors this exact matrix (Foundation §6) in get_effective_level + requirePermission.

import type { PermLevel } from "./types";

// Delete is no longer a granted capability. It's a hardcoded Super-Admin-only
// action enforced in drive-delete and hidden from the UI for other roles.
// canDelete was removed from this matrix on the move to the new deletion
// architecture (single deleter = super_admin).
export interface Capabilities {
  canView: boolean;
  canDownload: boolean;
  canUpload: boolean;
  canRename: boolean;
  canMove: boolean;
  canCreateSubfolder: boolean;
  canManageAccess: boolean; // grant/revoke access of this folder to others
}

export const PERM_LEVELS: PermLevel[] = [
  "no_access",
  "view",
  "view_download",
  "view_upload",
  "contributor",
  "full_control",
];

export const PERM_LABELS: Record<PermLevel, string> = {
  no_access: "No Access",
  view: "View Only",
  view_download: "View + Download",
  view_upload: "View + Upload",
  contributor: "Contributor",
  full_control: "Full Control",
};

export const PERM_COLORS: Record<PermLevel, string> = {
  no_access: "#9ca3af",
  view: "#3b82f6",
  view_download: "#22c55e",
  view_upload: "#f59e0b",
  contributor: "#8b5cf6",
  full_control: "#ef4444",
};

const NONE: Capabilities = {
  canView: false,
  canDownload: false,
  canUpload: false,
  canRename: false,
  canMove: false,
  canCreateSubfolder: false,
  canManageAccess: false,
};

export const CAPABILITIES: Record<PermLevel, Capabilities> = {
  no_access: { ...NONE },
  view: { ...NONE, canView: true },
  view_download: { ...NONE, canView: true, canDownload: true },
  view_upload: { ...NONE, canView: true, canDownload: true, canUpload: true },
  contributor: {
    canView: true,
    canDownload: true,
    canUpload: true,
    canRename: true,
    canMove: true,
    canCreateSubfolder: true,
    canManageAccess: false,
  },
  full_control: {
    canView: true,
    canDownload: true,
    canUpload: true,
    canRename: true,
    canMove: true,
    canCreateSubfolder: true,
    canManageAccess: true,
  },
};

export function capabilities(level: PermLevel): Capabilities {
  return CAPABILITIES[level] ?? CAPABILITIES.no_access;
}

const RANK: Record<PermLevel, number> = {
  no_access: 0,
  view: 1,
  view_download: 2,
  view_upload: 3,
  contributor: 4,
  full_control: 5,
};

export function levelRank(level: PermLevel): number {
  return RANK[level] ?? 0;
}

/** Returns the higher of two levels (used when combining user/department/role grants). */
export function maxLevel(a: PermLevel, b: PermLevel): PermLevel {
  return RANK[a] >= RANK[b] ? a : b;
}

export function can(level: PermLevel, capability: keyof Capabilities): boolean {
  return capabilities(level)[capability];
}
