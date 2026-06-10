// In-browser mock backend (localStorage). Implements the full Backend contract so the entire app
// runs and is demoable with ZERO cloud setup. It simulates the Supabase DB + Drive: folders, files,
// per-folder permission grants with inheritance, department ownership, cross-department assignees,
// the permanent Drive connection, and the hourly sync. Swap to SupabaseBackend by setting
// NEXT_PUBLIC_BACKEND_MODE=supabase (see config.ts).

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
import { COMPANY_ROOT_NAME } from "../config";
import { capabilities, levelRank, maxLevel } from "../permissions";
import type { Capabilities } from "../permissions";
import type { Backend, GrantInput, ListResult } from "./contract";
import { PermissionError } from "./contract";

// ---- internal record shapes (mirror the DB tables) ----
interface FolderRec {
  id: string;
  driveFileId: string;
  name: string;
  parentId: string | null;
  ownerDepartmentId: string | null;
  isRoot: boolean;
  path: string;
  createdBy: string | null;
  deleted: boolean;
}
interface FileRec {
  id: string;
  driveFileId: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  folderId: string;
  uploadedBy: string;
  webViewLink: string;
  modifiedAt: string;
  deleted: boolean;
}
interface GrantRec {
  id: string;
  folderId: string;
  principalType: PrincipalType;
  principalId: string;
  /**
   * Department scope for role grants (mirrors migration 0021's
   * permission_grants.principal_dept_id). NULL for user grants and
   * unscoped role grants. A real dept id narrows the grant to users with
   * this role AND this department.
   */
  principalDeptId: string | null;
  level: PermLevel;
  expiresAt: string | null;
}
interface AssigneeRec {
  id: string;
  folderId: string;
  userId: string;
  assignedBy: string | null;
}
interface ConnectionRec extends ConnectionStatus {
  locked: boolean;
}
interface DB {
  departments: Department[];
  users: AppUser[];
  folders: FolderRec[];
  files: FileRec[];
  grants: GrantRec[];
  assignees: AssigneeRec[];
  connection: ConnectionRec;
}

const KEY = "hexatech_vault_mock_v1";
const now = () => new Date().toISOString();
const uid = (p: string) => p + Math.random().toString(36).slice(2, 9);

// SSR-safe localStorage access. Under Next.js, getBackend() can be reached during
// server rendering of a client component module; in that case we just operate
// against an in-memory copy that hydrates with real storage on the client.
const hasStorage = () => typeof window !== "undefined" && typeof window.localStorage !== "undefined";

// ----------------------------------------------------------------------------
// Seed data — a realistic root-scoped tree so the features are immediately visible.
// ----------------------------------------------------------------------------
function seed(): DB {
  const departments: Department[] = [
    { id: "d-exec", name: "Executive" },
    { id: "d-hr", name: "HR & Admin" },
    { id: "d-proj", name: "Projects" },
    { id: "d-dev", name: "Development" },
    { id: "d-sales", name: "Sales" },
  ];
  const users: AppUser[] = [
    { id: "u-zara", name: "Zara Ahmed", email: "zara@hexatech.io", role: "super_admin", departmentId: "d-exec", departmentName: "Executive", avatar: "ZA" },
    { id: "u-omar", name: "Omar Farooq", email: "omar@hexatech.io", role: "admin", departmentId: "d-hr", departmentName: "HR & Admin", avatar: "OF" },
    { id: "u-sara", name: "Sara Khan", email: "sara@hexatech.io", role: "manager", departmentId: "d-proj", departmentName: "Projects", avatar: "SK" },
    { id: "u-ali", name: "Ali Hassan", email: "ali@hexatech.io", role: "team_lead", departmentId: "d-dev", departmentName: "Development", avatar: "AH" },
    { id: "u-raza", name: "Raza Malik", email: "raza@hexatech.io", role: "lead_dev", departmentId: "d-dev", departmentName: "Development", avatar: "RM" },
    { id: "u-hina", name: "Hina Baig", email: "hina@hexatech.io", role: "team_member", departmentId: "d-sales", departmentName: "Sales", avatar: "HB" },
  ];

  const f = (id: string, name: string, parentId: string | null, owner: string | null, path: string, isRoot = false): FolderRec => ({
    id, driveFileId: "drv-" + id, name, parentId, ownerDepartmentId: owner, isRoot, path, createdBy: "u-zara", deleted: false,
  });
  const R = "/" + COMPANY_ROOT_NAME;
  const folders: FolderRec[] = [
    f("f-root", COMPANY_ROOT_NAME, null, null, R, true),
    f("f-hr", "HR & Admin", "f-root", "d-hr", R + "/HR & Admin"),
    f("f-hr-pol", "Policies & SOPs", "f-hr", "d-hr", R + "/HR & Admin/Policies & SOPs"),
    f("f-hr-pay", "Payroll Data", "f-hr", "d-hr", R + "/HR & Admin/Payroll Data"),
    f("f-proj", "Projects", "f-root", "d-proj", R + "/Projects"),
    f("f-proj-alpha", "Project Alpha", "f-proj", "d-proj", R + "/Projects/Project Alpha"),
    f("f-proj-beta", "Project Beta", "f-proj", "d-proj", R + "/Projects/Project Beta"),
    f("f-dev", "Development", "f-root", "d-dev", R + "/Development"),
    f("f-dev-app", "App Codebase", "f-dev", "d-dev", R + "/Development/App Codebase"),
    f("f-assets", "Company Assets", "f-root", "d-sales", R + "/Company Assets"),
    f("f-assets-brand", "Brand Guidelines", "f-assets", "d-sales", R + "/Company Assets/Brand Guidelines"),
    f("f-wordpress", "WordPress", "f-root", "d-exec", R + "/WordPress"),
    f("f-legal", "Legal", "f-root", "d-exec", R + "/Legal"),
  ];

  const file = (id: string, name: string, mime: string, size: number, folderId: string, by: string): FileRec => ({
    id, driveFileId: "drv-" + id, name, mimeType: mime, sizeBytes: size, folderId, uploadedBy: by,
    webViewLink: "#", modifiedAt: now(), deleted: false,
  });
  const files: FileRec[] = [
    file("file-pol", "Company_Policy_2026.pdf", "application/pdf", 2_516_582, "f-hr-pol", "Omar Farooq"),
    file("file-pay", "Payroll_Q1.xlsx", "application/vnd.ms-excel", 1_153_433, "f-hr-pay", "Omar Farooq"),
    file("file-alpha", "Project_Alpha_Deck.pptx", "application/vnd.ms-powerpoint", 6_815_744, "f-proj-alpha", "Sara Khan"),
    file("file-brand", "Brand_Guidelines_v3.pdf", "application/pdf", 9_122_611, "f-assets-brand", "Hina Baig"),
    file("file-app", "README.md", "text/markdown", 4_096, "f-dev-app", "Raza Malik"),
    file("file-fin", "Financial_Summary_Q1.xlsx", "application/vnd.ms-excel", 419_430, "f-finance", "Zara Ahmed"),
  ];

  const g = (folderId: string, pt: PrincipalType, pid: string, level: PermLevel): GrantRec => ({
    id: uid("g-"), folderId, principalType: pt, principalId: pid, principalDeptId: null, level, expiresAt: null,
  });
  // Department-level grants give each owning department working access to its own branch.
  const grants: GrantRec[] = [
    // Department grants were removed from the permission system - principal
    // types are now user + role only. Mock seed data left empty here; demo
    // users get access via the role-based grants further below if any.
    // Cross-department assignees (item 6 demo): explicit user grants accompany the assignee rows.
    g("f-proj-alpha", "user", "u-hina", "view_download"),
    g("f-assets-brand", "user", "u-raza", "view_upload"),
  ];
  const assignees: AssigneeRec[] = [
    { id: uid("a-"), folderId: "f-proj-alpha", userId: "u-hina", assignedBy: "u-sara" },
    { id: uid("a-"), folderId: "f-assets-brand", userId: "u-raza", assignedBy: "u-hina" },
  ];

  const connection: ConnectionRec = {
    connected: false, accountEmail: null, rootFolderName: null, connectedAt: null, lastSyncAt: null, locked: false,
  };

  return { departments, users, folders, files, grants, assignees, connection };
}

// ----------------------------------------------------------------------------
export class MockBackend implements Backend {
  private db: DB;
  private actor: AppUser | null = null;

  constructor() {
    this.db = this.load();
  }

  private load(): DB {
    try {
      if (hasStorage()) {
        const raw = window.localStorage.getItem(KEY);
        if (raw) return JSON.parse(raw) as DB;
      }
    } catch {
      /* ignore corrupt state */
    }
    const fresh = seed();
    this.persist(fresh);
    return fresh;
  }
  private persist(db = this.db) {
    try {
      if (hasStorage()) window.localStorage.setItem(KEY, JSON.stringify(db));
    } catch {
      /* storage full / unavailable */
    }
  }
  /** Wipe local state back to seed (used by a dev "reset demo data" action). */
  reset() {
    this.db = seed();
    this.persist();
  }

  setActor(user: AppUser | null) {
    this.actor = user;
  }
  private me(): AppUser {
    if (!this.actor) throw new PermissionError("Not signed in.");
    return this.actor;
  }

  // --- permission resolution (mirrors Foundation §6) ---
  private folder(id: string): FolderRec | undefined {
    return this.db.folders.find((x) => x.id === id && !x.deleted);
  }
  private ancestors(folderId: string): FolderRec[] {
    const chain: FolderRec[] = [];
    let cur = this.folder(folderId);
    const guard = new Set<string>();
    while (cur && !guard.has(cur.id)) {
      chain.push(cur);
      guard.add(cur.id);
      cur = cur.parentId ? this.folder(cur.parentId) : undefined;
    }
    return chain; // nearest first, root last
  }
  private grantActive(grant: GrantRec): boolean {
    return !grant.expiresAt || new Date(grant.expiresAt).getTime() > Date.now();
  }
  /**
   * Effective permission level for a user on a folder. USER-WINS semantics
   * (mirrors get_effective_level() in SQL migration 0018):
   *
   * Walk folder → root, nearest first. At each ancestor:
   *   1. If a personal user grant exists for the caller → return its level,
   *      even if 'no_access' (explicit revocation).
   *   2. Else if a role grant exists for the caller's role → return that level.
   *   3. Else climb to the parent.
   * If no ancestor has any applicable grant → 'no_access'.
   *
   * User grant always overrides role grant at the same ancestor, so a Super
   * Admin can promote an individual user above their role's baseline AND can
   * lock a specific user OUT of a role-granted folder.
   */
  effectiveLevel(user: AppUser, folderId: string): PermLevel {
    if (user.role === "super_admin") return "full_control";
    for (const node of this.ancestors(folderId)) {
      // 1. Personal user grant — wins over every other principal at this ancestor.
      const userGrant = this.db.grants.find(
        (g) =>
          g.folderId === node.id &&
          this.grantActive(g) &&
          g.principalType === "user" &&
          g.principalId === user.id,
      );
      if (userGrant) return userGrant.level;
      // 2. NEW: role+dept grant — more specific than an unscoped role grant.
      if (user.departmentId) {
        const roleDept = this.db.grants.find(
          (g) =>
            g.folderId === node.id &&
            this.grantActive(g) &&
            g.principalType === "role" &&
            g.principalId === user.role &&
            g.principalDeptId === user.departmentId,
        );
        if (roleDept) return roleDept.level;
      }
      // 3. Unscoped role grant (principalDeptId === null) — "all departments".
      const roleUnscoped = this.db.grants.find(
        (g) =>
          g.folderId === node.id &&
          this.grantActive(g) &&
          g.principalType === "role" &&
          g.principalId === user.role &&
          (g.principalDeptId == null),
      );
      if (roleUnscoped) return roleUnscoped.level;
    }
    return "no_access";
  }
  private require(folderId: string, capability: keyof Capabilities) {
    const level = this.effectiveLevel(this.me(), folderId);
    if (!capabilities(level)[capability]) {
      throw new PermissionError();
    }
    return level;
  }

  private deptName(id: string | null): string | null {
    if (!id) return null;
    return this.db.departments.find((d) => d.id === id)?.name ?? null;
  }
  private toFolderDTO(rec: FolderRec, user: AppUser): FolderDTO {
    return {
      id: rec.id,
      driveFileId: rec.driveFileId,
      name: rec.name,
      parentId: rec.parentId,
      ownerDepartmentId: rec.ownerDepartmentId,
      ownerDepartmentName: this.deptName(rec.ownerDepartmentId),
      isRoot: rec.isRoot,
      path: rec.path,
      myLevel: this.effectiveLevel(user, rec.id),
    };
  }
  private toFileDTO(rec: FileRec, user: AppUser): FileDTO {
    return {
      id: rec.id,
      driveFileId: rec.driveFileId,
      name: rec.name,
      mimeType: rec.mimeType,
      sizeBytes: rec.sizeBytes,
      folderId: rec.folderId,
      uploadedBy: rec.uploadedBy,
      webViewLink: rec.webViewLink,
      modifiedAt: rec.modifiedAt,
      myLevel: this.effectiveLevel(user, rec.folderId),
    };
  }

  // --- connection (item 1) + sync (item 2) ---
  async getConnectionStatus(): Promise<ConnectionStatus> {
    const c = this.db.connection;
    return { connected: c.connected, accountEmail: c.accountEmail, rootFolderName: c.rootFolderName, connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt };
  }
  async startDriveConnect(): Promise<{ url: string }> {
    if (this.me().role !== "super_admin") throw new PermissionError("Only the Super Admin can connect Google Drive.");
    if (this.db.connection.locked) throw new Error("Drive is already connected. The connection is permanent.");
    return { url: "#mock-oauth" }; // mock mode: UI calls mockConnect() instead of redirecting
  }
  async mockConnect(accountEmail: string): Promise<ConnectionStatus> {
    if (this.me().role !== "super_admin") throw new PermissionError("Only the Super Admin can connect Google Drive.");
    if (this.db.connection.locked) throw new Error("Drive is already connected. The connection is permanent and cannot be changed.");
    this.db.connection = {
      connected: true,
      accountEmail,
      rootFolderName: COMPANY_ROOT_NAME,
      connectedAt: now(),
      lastSyncAt: now(),
      locked: true,
    };
    this.persist();
    return this.getConnectionStatus();
  }
  async syncNow(): Promise<SyncResult> {
    if (!this.db.connection.connected) throw new Error("Connect Google Drive first.");
    this.db.connection.lastSyncAt = now();
    this.persist();
    return { added: 0, updated: 0, removed: 0, status: "success", finishedAt: now() };
  }

  // --- browsing (item 3: everything is under the root) ---
  async list(folderId?: string | null): Promise<ListResult> {
    const user = this.me();
    const root = this.db.folders.find((x) => x.isRoot)!;
    const targetId = folderId ?? root.id;
    const childFolders = this.db.folders
      .filter((x) => x.parentId === targetId && !x.deleted)
      .filter((x) => this.effectiveLevel(user, x.id) !== "no_access")
      .map((x) => this.toFolderDTO(x, user));
    const canViewHere = this.effectiveLevel(user, targetId) !== "no_access";
    const childFiles = canViewHere
      ? this.db.files.filter((x) => x.folderId === targetId && !x.deleted).map((x) => this.toFileDTO(x, user))
      : [];
    // breadcrumb root -> target
    const breadcrumb = this.ancestors(targetId).reverse().map((x) => ({ id: x.id, name: x.name }));
    return { folders: childFolders, files: childFiles, breadcrumb };
  }

  // --- shared with me (item 6) ---
  async sharedWithMe(): Promise<FolderDTO[]> {
    const user = this.me();
    const assignedFolderIds = new Set(this.db.assignees.filter((a) => a.userId === user.id).map((a) => a.folderId));
    // also any folder where the user has a direct user grant
    this.db.grants.forEach((gr) => {
      if (gr.principalType === "user" && gr.principalId === user.id && this.grantActive(gr)) assignedFolderIds.add(gr.folderId);
    });
    return this.db.folders
      .filter((fr) => !fr.deleted && assignedFolderIds.has(fr.id))
      .filter((fr) => fr.ownerDepartmentId !== user.departmentId) // owner-dept members see it in the normal tree, not here
      .filter((fr) => this.effectiveLevel(user, fr.id) !== "no_access")
      .map((fr) => this.toFolderDTO(fr, user));
  }

  // --- creation (item 5) ---
  async createFolder(input: { parentFolderId: string; name: string; ownerDepartmentId: string; roleContext?: string; access: GrantInput[] }): Promise<FolderDTO> {
    const user = this.me();
    this.require(input.parentFolderId, "canCreateSubfolder");
    const parent = this.folder(input.parentFolderId);
    if (!parent) throw new Error("Parent folder not found.");
    const id = uid("f-");
    const rec: FolderRec = {
      id,
      driveFileId: uid("drv-"),
      name: input.name.trim() || "Untitled",
      parentId: parent.id,
      ownerDepartmentId: input.ownerDepartmentId,
      isRoot: false,
      path: parent.path + "/" + (input.name.trim() || "Untitled"),
      createdBy: user.id,
      deleted: false,
    };
    this.db.folders.push(rec);

    // Creator always gets full control of what they created.
    this.upsertGrant(id, "user", user.id, "full_control");
    // (Owner-department auto-grant removed - department is no longer a grant
    // principal. Owner-department remains a metadata field on folders for
    // reporting / breadcrumbs but does not confer access on its own.)

    // Apply the access list from step 3 of the wizard. Prevent privilege escalation:
    // a non-super-admin cannot grant a level higher than their own on the parent.
    const ceiling = user.role === "super_admin" ? "full_control" : this.effectiveLevel(user, parent.id);
    for (const a of input.access) {
      const level = levelRank(a.level) > levelRank(ceiling) ? ceiling : a.level;
      this.upsertGrant(id, a.principalType, a.principalId, level);
      // cross-department member -> also create an assignee row (item 6)
      if (a.principalType === "user") {
        const u = this.db.users.find((x) => x.id === a.principalId);
        if (u && u.departmentId !== input.ownerDepartmentId) {
          if (!this.db.assignees.some((x) => x.folderId === id && x.userId === u.id)) {
            this.db.assignees.push({ id: uid("a-"), folderId: id, userId: u.id, assignedBy: user.id });
          }
        }
      }
    }
    this.persist();
    return this.toFolderDTO(rec, user);
  }

  async uploadFile(input: { folderId: string; name: string; mimeType: string; sizeBytes?: number }): Promise<FileDTO> {
    this.require(input.folderId, "canUpload");
    const rec: FileRec = {
      id: uid("file-"),
      driveFileId: uid("drv-"),
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes ?? 0,
      folderId: input.folderId,
      uploadedBy: this.me().name,
      webViewLink: "#",
      modifiedAt: now(),
      deleted: false,
    };
    this.db.files.push(rec);
    this.persist();
    return this.toFileDTO(rec, this.me());
  }

  async deleteItem(input: { id: string; kind: "folder" | "file" }): Promise<{ ok: boolean }> {
    // Delete is Super-Admin-only (matches the real backend's drive-delete gate).
    // No level-based capability check; we just verify role here.
    if (this.me().role !== "super_admin") {
      throw new PermissionError("Only the Super Admin can delete folders or files");
    }
    if (input.kind === "folder") {
      const fr = this.folder(input.id);
      if (fr) fr.deleted = true;
    } else {
      const file = this.db.files.find((x) => x.id === input.id);
      if (file) file.deleted = true;
    }
    this.persist();
    return { ok: true };
  }

  async getDownloadUrl(fileId: string): Promise<{ url: string }> {
    const file = this.db.files.find((x) => x.id === fileId && !x.deleted);
    if (!file) throw new Error("File not found.");
    this.require(file.folderId, "canDownload");
    return { url: file.webViewLink || "#" };
  }

  // --- permissions (item 4) ---
  private upsertGrant(
    folderId: string,
    pt: PrincipalType,
    pid: string,
    level: PermLevel,
    expiresAt: string | null = null,
    principalDeptId: string | null = null,
  ) {
    // Existing row matches on the FULL key including principalDeptId. A
    // role+dept grant and a role-unscoped grant on the same folder for the
    // same role are distinct rows.
    const existing = this.db.grants.find(
      (g) =>
        g.folderId === folderId &&
        g.principalType === pt &&
        g.principalId === pid &&
        (g.principalDeptId ?? null) === (principalDeptId ?? null),
    );
    // Role + no_access = "clear the slot", not "explicit revocation". Matches
    // the supabase backend (permissions-set Edge Function). User + no_access
    // remains an explicit revocation and is stored as a row (documented in
    // .claude/rules/permissions.md).
    if (level === "no_access" && pt === "role") {
      this.db.grants = this.db.grants.filter((g) => g !== existing);
      return;
    }
    if (existing) {
      existing.level = level;
      existing.expiresAt = expiresAt;
    } else {
      this.db.grants.push({
        id: uid("g-"),
        folderId,
        principalType: pt,
        principalId: pid,
        principalDeptId: pt === "user" ? null : principalDeptId,
        level,
        expiresAt,
      });
    }
  }
  private principalLabel(pt: PrincipalType, pid: string): string {
    if (pt === "user") return this.db.users.find((u) => u.id === pid)?.name ?? pid;
    return pid; // role
  }
  async getGrants(folderId: string): Promise<GrantDTO[]> {
    return this.db.grants
      .filter((g) => g.folderId === folderId)
      .map((g) => {
        const dept = g.principalDeptId
          ? this.db.departments.find((d) => d.id === g.principalDeptId)?.name ?? null
          : null;
        const base = this.principalLabel(g.principalType, g.principalId);
        return {
          id: g.id,
          folderId: g.folderId,
          principalType: g.principalType,
          principalId: g.principalId,
          principalDeptId: g.principalDeptId ?? null,
          // Match the live backend: "<role> · <dept>" when scoped.
          principalLabel: dept ? `${base} · ${dept}` : base,
          level: g.level,
          expiresAt: g.expiresAt,
        };
      });
  }
  async setGrant(input: {
    folderId: string;
    principalType: PrincipalType;
    principalId: string;
    principalDeptId?: string | null;
    level: PermLevel;
    expiresAt?: string | null;
  }): Promise<{ ok: boolean }> {
    const user = this.me();
    if (user.role !== "super_admin") this.require(input.folderId, "canManageAccess");
    // User grants force dept to null; role grants accept null (unscoped) or a dept id.
    const dept = input.principalType === "user" ? null : (input.principalDeptId ?? null);
    this.upsertGrant(input.folderId, input.principalType, input.principalId, input.level, input.expiresAt ?? null, dept);
    this.persist();
    return { ok: true };
  }

  // --- assignees (item 6) ---
  async listAssignees(folderId: string): Promise<AssigneeDTO[]> {
    return this.db.assignees
      .filter((a) => a.folderId === folderId)
      .map((a) => {
        const u = this.db.users.find((x) => x.id === a.userId);
        const grant = this.db.grants.find((g) => g.folderId === folderId && g.principalType === "user" && g.principalId === a.userId);
        return {
          userId: a.userId,
          name: u?.name ?? a.userId,
          department: u?.departmentName ?? "",
          level: grant?.level ?? "view",
        };
      });
  }
  async addAssignee(input: { folderId: string; userId: string; level: PermLevel }): Promise<{ ok: boolean }> {
    const user = this.me();
    if (user.role !== "super_admin") this.require(input.folderId, "canManageAccess");
    if (!this.db.assignees.some((a) => a.folderId === input.folderId && a.userId === input.userId)) {
      this.db.assignees.push({ id: uid("a-"), folderId: input.folderId, userId: input.userId, assignedBy: user.id });
    }
    this.upsertGrant(input.folderId, "user", input.userId, input.level);
    this.persist();
    return { ok: true };
  }
  async removeAssignee(input: { folderId: string; userId: string }): Promise<{ ok: boolean }> {
    const user = this.me();
    if (user.role !== "super_admin") this.require(input.folderId, "canManageAccess");
    this.db.assignees = this.db.assignees.filter((a) => !(a.folderId === input.folderId && a.userId === input.userId));
    this.upsertGrant(input.folderId, "user", input.userId, "no_access");
    this.persist();
    return { ok: true };
  }

  // --- directory ---
  async listDepartments(): Promise<Department[]> {
    return [...this.db.departments];
  }
  async listUsers(): Promise<AppUser[]> {
    return [...this.db.users];
  }
}
