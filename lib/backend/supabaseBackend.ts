// Supabase-mode backend. Calls the Edge Functions over HTTPS. The server enforces auth +
// permissions + root scoping; this client just relays requests with the user's access token.
// The access token is sourced from the @supabase/ssr browser client's cookie session on every
// call (so it stays fresh even after the session is refreshed by middleware). Activated when
// NEXT_PUBLIC_BACKEND_MODE=supabase.

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
import { FUNCTIONS_URL, SUPABASE_ANON_KEY } from "../config";
import { createSupabaseBrowserClient } from "../supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Backend, GrantInput, ListResult } from "./contract";
import { PermissionError } from "./contract";

export class SupabaseBackend implements Backend {
  private browserClient: SupabaseClient | null = null;

  // user is informational only — the server derives identity from the JWT cookie.
  // accessToken arg is kept for compatibility with the MockBackend signature but ignored here:
  // SupabaseBackend reads a fresh token from the cookie session on every call.
  setActor(_user: AppUser | null, _accessToken?: string | null) {
    /* no-op */
  }

  private getClient(): SupabaseClient | null {
    if (typeof window === "undefined") return null;
    if (!this.browserClient) {
      try {
        this.browserClient = createSupabaseBrowserClient();
      } catch {
        return null;
      }
    }
    return this.browserClient;
  }

  /** Read the current access token from the cookie session (fresh each call). */
  private async currentToken(): Promise<string | null> {
    const client = this.getClient();
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  private async post<T>(path: string, body: unknown = {}): Promise<T> {
    const token = await this.currentToken();
    const res = await fetch(`${FUNCTIONS_URL}/${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token ?? SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (res.status === 403) throw new PermissionError(await safeMessage(res));
    if (!res.ok) throw new Error(await safeMessage(res));
    return (await res.json()) as T;
  }

  getConnectionStatus() {
    return this.post<ConnectionStatus>("connection-status");
  }
  startDriveConnect() {
    return this.post<{ url: string }>("drive-oauth-start");
  }
  async mockConnect(): Promise<ConnectionStatus> {
    throw new Error("mockConnect is not available in Supabase mode — use the real Google OAuth flow.");
  }
  syncNow() {
    return this.post<SyncResult>("sync-drive");
  }

  list(folderId?: string | null) {
    return this.post<ListResult>("drive-list", { folderId: folderId ?? null });
  }
  sharedWithMe() {
    return this.post<{ folders: FolderDTO[] }>("shared-with-me").then((r) => r.folders);
  }

  createFolder(input: { parentFolderId: string; name: string; ownerDepartmentId: string; roleContext?: string; access: GrantInput[] }) {
    return this.post<{ folder: FolderDTO }>("folder-create", input).then((r) => r.folder);
  }
  uploadFile(input: { folderId: string; name: string; mimeType: string; sizeBytes?: number }) {
    return this.post<{ file: FileDTO }>("drive-upload", input).then((r) => r.file);
  }
  deleteItem(input: { id: string; kind: "folder" | "file" }) {
    return this.post<{ ok: boolean }>("drive-delete", input);
  }
  async getDownloadUrl(fileId: string) {
    // Backend returns { name, mimeType, webViewLink, webContentLink }; the UI just needs a URL.
    const r = await this.post<{ webContentLink?: string | null; webViewLink?: string | null }>("drive-download", { fileId });
    return { url: r.webContentLink || r.webViewLink || "#" };
  }

  getGrants(folderId: string) {
    return this.post<{ grants: GrantDTO[] }>("permissions-get", { folderId }).then((r) => r.grants);
  }
  setGrant(input: {
    folderId: string;
    principalType: PrincipalType;
    principalId: string;
    /** Optional department scope for role grants (migration 0021). */
    principalDeptId?: string | null;
    level: PermLevel;
    expiresAt?: string | null;
  }) {
    return this.post<{ ok: boolean }>("permissions-set", input);
  }

  listAssignees(folderId: string) {
    return this.post<{ assignees: AssigneeDTO[] }>("assignees-list", { folderId }).then((r) => r.assignees);
  }
  addAssignee(input: { folderId: string; userId: string; level: PermLevel }) {
    return this.post<{ ok: boolean }>("assignees-add", input);
  }
  removeAssignee(input: { folderId: string; userId: string }) {
    return this.post<{ ok: boolean }>("assignees-remove", input);
  }

  listDepartments() {
    return this.post<{ departments: Department[] }>("directory-departments").then((r) => r.departments);
  }
  listUsers() {
    return this.post<{ users: AppUser[] }>("directory-users").then((r) => r.users);
  }
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    return (data && (data.error || data.message)) || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}
