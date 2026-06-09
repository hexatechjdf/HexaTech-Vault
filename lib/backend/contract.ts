// The Backend interface: the complete API surface the UI uses, independent of mock vs Supabase.
// MockBackend implements it in-browser (localStorage); SupabaseBackend implements it by calling
// the Edge Functions described in IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md §7.

import type {
  AppUser,
  AssigneeDTO,
  ConnectionStatus,
  Department,
  FileDTO,
  FolderDTO,
  GrantDTO,
  PermLevel,
  PrincipalType,
  SyncResult,
} from "../types";

export interface ListResult {
  folders: FolderDTO[];
  files: FileDTO[];
  breadcrumb: { id: string; name: string }[];
}

export interface GrantInput {
  principalType: PrincipalType;
  principalId: string;
  /**
   * Department scope for role grants (migration 0021). Omit/null = unscoped
   * ("all departments"). A real department uuid narrows the grant to users
   * with this role AND this department. Must be null/undefined when
   * principalType === 'user'.
   */
  principalDeptId?: string | null;
  level: PermLevel;
}

export interface Backend {
  /**
   * Tell the backend who is acting. Mock uses this to resolve effective permissions;
   * Supabase uses the access token for the Authorization header (server derives identity from JWT).
   */
  setActor(user: AppUser | null, accessToken?: string | null): void;

  // --- Item 1 (connection) + Item 2 (sync) ---
  getConnectionStatus(): Promise<ConnectionStatus>;
  /** Returns the Google OAuth consent URL to redirect to (super admin only; enforced server-side). */
  startDriveConnect(): Promise<{ url: string }>;
  /** Mock-only: simulate a successful, permanent connection without real Google OAuth. */
  mockConnect(accountEmail: string): Promise<ConnectionStatus>;
  syncNow(): Promise<SyncResult>;

  // --- Item 3 (root-scoped browsing) ---
  list(folderId?: string | null): Promise<ListResult>;

  // --- Item 6 (shared with me) ---
  sharedWithMe(): Promise<FolderDTO[]>;

  // --- Item 5 (creation) + files ---
  createFolder(input: {
    parentFolderId: string;
    name: string;
    ownerDepartmentId: string;
    roleContext?: string;
    access: GrantInput[];
  }): Promise<FolderDTO>;
  uploadFile(input: {
    folderId: string;
    name: string;
    mimeType: string;
    sizeBytes?: number;
  }): Promise<FileDTO>;
  deleteItem(input: { id: string; kind: "folder" | "file" }): Promise<{ ok: boolean }>;
  getDownloadUrl(fileId: string): Promise<{ url: string }>;

  // --- Item 4 (permissions) ---
  getGrants(folderId: string): Promise<GrantDTO[]>;
  setGrant(input: {
    folderId: string;
    principalType: PrincipalType;
    principalId: string;
    /**
     * Department scope for role grants. Omit/null = unscoped ("all
     * departments"). Must be null/undefined for user grants.
     */
    principalDeptId?: string | null;
    level: PermLevel;
    expiresAt?: string | null;
  }): Promise<{ ok: boolean }>;

  // --- Item 6 (assignees) ---
  listAssignees(folderId: string): Promise<AssigneeDTO[]>;
  addAssignee(input: { folderId: string; userId: string; level: PermLevel }): Promise<{ ok: boolean }>;
  removeAssignee(input: { folderId: string; userId: string }): Promise<{ ok: boolean }>;

  // --- Directory (for pickers) ---
  listDepartments(): Promise<Department[]>;
  listUsers(): Promise<AppUser[]>;
}

export class PermissionError extends Error {
  constructor(message = "You don't have permission to do that.") {
    super(message);
    this.name = "PermissionError";
  }
}
