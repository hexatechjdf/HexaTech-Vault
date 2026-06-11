// Shared domain types for HexaTech Vault.
// These mirror the Supabase schema in IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md
// and the Edge Function JSON contract. Frontend (mock + supabase) and backend agree on these shapes.

export type Role =
  | "super_admin"
  | "admin"
  | "manager"
  | "team_lead"
  | "lead_dev"
  | "team_member";

// Folder permission levels (the selectable list a super admin / folder manager picks from).
export type PermLevel =
  | "no_access"
  | "view"
  | "view_download"
  | "view_upload"
  | "contributor"
  | "full_control";

// Department was removed as a principal type. The permission system now
// supports user-based and role-based grants only.
export type PrincipalType = "user" | "role";

export interface Department {
  id: string;
  name: string;
}

export interface AppUser {
  id: string;
  name: string;
  /** Login email (used to authenticate to the app). Can be a company/system address. */
  email: string;
  /**
   * Google account email used for Drive sharing. Set by the user on their
   * Profile page. Distinct from the login email. May be null until the user
   * configures it; permissions-set falls back to `email` in that case.
   */
  googleEmail?: string | null;
  role: Role;
  departmentId: string;
  departmentName: string;
  avatar: string;
  status?: "active" | "inactive";
}

export interface FolderDTO {
  id: string;
  driveFileId: string;
  name: string;
  parentId: string | null;
  ownerDepartmentId: string | null;
  ownerDepartmentName: string | null;
  isRoot: boolean;
  path: string;
  myLevel: PermLevel; // the current user's effective permission on this folder
  /** When the folder's cache row was last touched (matches DB updated_at). */
  updatedAt?: string;
  /** Count of direct children (subfolders + files), excluding soft-deleted. */
  itemCount?: number;
}

export interface FileDTO {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string;
  uploadedBy: string;
  webViewLink?: string;
  modifiedAt: string;
  myLevel: PermLevel; // inherited from the containing folder
}

export interface GrantDTO {
  id: string;
  folderId: string;
  principalType: PrincipalType;
  principalId: string;
  /**
   * Department scope for role grants (migration 0021). NULL for user grants
   * and unscoped role grants ("all departments"). A real department uuid
   * means the grant only applies to users with this role AND this department.
   * Always NULL when `principalType === 'user'`.
   */
  principalDeptId: string | null;
  principalLabel: string;
  level: PermLevel;
  expiresAt: string | null;
}

export interface AssigneeDTO {
  userId: string;
  name: string;
  department: string;
  level: PermLevel;
}

export interface ConnectionStatus {
  connected: boolean;
  accountEmail: string | null;
  rootFolderName: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
}

export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  status: "success" | "error";
  finishedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy shape consumed by the presentational components (dashboards, Layout,
// LoginPage). Kept here so existing components don't have to be rewritten to
// accept AppUser directly. The (app)/layout shim adapts AppUser → User.
// ─────────────────────────────────────────────────────────────────────────────
export interface User {
  name: string;
  email: string;
  role: Role;
  department: string;
  avatar: string;
}

// Screens enum used by the dashboard/Layout components for navigation typing.
// In the Next.js port these correspond to route segments — the (app)/layout
// derives the active "screen" from useSelectedLayoutSegment().
export type Screen =
  | "login"
  | "dashboard"
  | "users"
  | "folders"
  | "tabs"
  | "audit"
  | "files"
  | "storage"
  | "settings"
  | "profile"
  | "upload";
