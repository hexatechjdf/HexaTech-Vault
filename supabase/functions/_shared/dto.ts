// DTO shapes shared with the frontend (API CONTRACT). Mapping helpers convert
// DB rows into these exact shapes. Keep these in lockstep with the frontend.

import { serviceClient } from "./supabase.ts";
import { getEffectiveLevel, PermLevel } from "./permissions.ts";

export interface FolderDTO {
  id: string;
  driveFileId: string;
  name: string;
  parentId: string | null;
  ownerDepartmentId: string | null;
  ownerDepartmentName: string | null;
  isRoot: boolean;
  path: string | null;
  myLevel: PermLevel;
  /** When the cache row was last touched (matches folders.updated_at). */
  updatedAt?: string | null;
  /** Number of direct, non-deleted children (subfolders + files). */
  itemCount?: number;
}

export interface FileDTO {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  folderId: string | null;
  uploadedBy: string | null;
  webViewLink: string | null;
  modifiedAt: string | null;
  myLevel: PermLevel;
}

export interface GrantDTO {
  id: string;
  folderId: string;
  principalType: string;
  principalId: string;
  /**
   * Department scope for role grants (migration 0021). NULL for user grants
   * and unscoped role grants ("all departments"). A real uuid means the grant
   * applies only to users with this role *and* this department.
   */
  principalDeptId: string | null;
  principalLabel: string;
  level: PermLevel;
  expiresAt: string | null;
}

export interface AssigneeDTO {
  userId: string;
  name: string;
  department: string | null;
  level: PermLevel;
}

// Raw row shapes (subset of columns selected by the functions).
export interface FolderRow {
  id: string;
  drive_file_id: string;
  name: string;
  parent_id: string | null;
  is_root: boolean;
  owner_department_id: string | null;
  path: string | null;
  /** Only present when the SELECT included updated_at (drive-list does). */
  updated_at?: string | null;
  departments?: { name: string } | null; // when joined
}

export interface FileRow {
  id: string;
  drive_file_id: string;
  name: string;
  mime_type: string | null;
  size_bytes: number | null;
  folder_id: string | null;
  uploaded_by: string | null;
  web_view_link: string | null;
  modified_at: string | null;
}

/** Maps a folder row to FolderDTO, resolving the caller's effective level. */
export async function toFolderDTO(
  row: FolderRow,
  userId: string,
  deptNameOverride?: string | null,
  itemCount?: number,
): Promise<FolderDTO> {
  const myLevel = await getEffectiveLevel(userId, row.id);
  return {
    id: row.id,
    driveFileId: row.drive_file_id,
    name: row.name,
    parentId: row.parent_id,
    ownerDepartmentId: row.owner_department_id,
    ownerDepartmentName: deptNameOverride ?? row.departments?.name ?? null,
    isRoot: row.is_root,
    path: row.path,
    myLevel,
    updatedAt: row.updated_at ?? null,
    itemCount,
  };
}

/** Maps a file row to FileDTO. The caller's level comes from its folder. */
export async function toFileDTO(
  row: FileRow,
  userId: string,
): Promise<FileDTO> {
  const myLevel = row.folder_id
    ? await getEffectiveLevel(userId, row.folder_id)
    : ("no_access" as PermLevel);
  return {
    id: row.id,
    driveFileId: row.drive_file_id,
    name: row.name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes !== null && row.size_bytes !== undefined
      ? Number(row.size_bytes)
      : null,
    folderId: row.folder_id,
    uploadedBy: row.uploaded_by,
    webViewLink: row.web_view_link,
    modifiedAt: row.modified_at,
    myLevel,
  };
}

/** Builds a human-readable label for a grant's principal. */
export async function principalLabel(
  principalType: string,
  principalId: string,
): Promise<string> {
  const svc = serviceClient();
  if (principalType === "user") {
    const { data } = await svc
      .from("app_users")
      .select("name")
      .eq("id", principalId)
      .maybeSingle();
    return data?.name ?? principalId;
  }
  if (principalType === "department") {
    const { data } = await svc
      .from("departments")
      .select("name")
      .eq("id", principalId)
      .maybeSingle();
    return data?.name ?? principalId;
  }
  // role
  return principalId;
}
