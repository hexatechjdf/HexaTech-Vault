// Google Drive integration: the single source of truth for Drive auth + thin
// REST helpers. The backend is the ONLY holder of Google credentials.
//
// getAccessToken() returns a valid access token, minting a new one from the
// stored refresh token whenever the cached token is within 5 minutes of expiry
// (Foundation §4). The rotating access token lives in `drive_tokens` so the
// locked `drive_connection` row is never mutated (item 01).

import { serviceClient, requireEnv } from "./supabase.ts";
import { decrypt } from "./crypto.ts";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const REFRESH_SKEW_MS = 5 * 60 * 1000; // refresh when within 5 min of expiry

// ---------------------------------------------------------------------------
// Token acquisition / refresh
// ---------------------------------------------------------------------------

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

/** Exchanges an authorization code for tokens (used by drive-oauth-callback). */
export async function exchangeCodeForTokens(
  code: string,
): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    redirect_uri: requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status})`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/** Mints a fresh access token from a refresh token. */
async function refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: requireEnv("GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}) — refresh token may be revoked`);
  }
  return (await res.json()) as GoogleTokenResponse;
}

/**
 * Returns a valid Google access token. Reads the cached token from
 * drive_tokens; if missing or within REFRESH_SKEW_MS of expiry, refreshes using
 * the encrypted refresh token (preferring drive_tokens, falling back to
 * drive_connection) and persists the new access token + expiry to drive_tokens.
 */
export async function getAccessToken(): Promise<string> {
  const svc = serviceClient();

  const { data: tokens } = await svc
    .from("drive_tokens")
    .select("access_token, token_expiry, refresh_token_encrypted")
    .eq("id", true)
    .maybeSingle();

  const now = Date.now();
  const expiryMs = tokens?.token_expiry ? new Date(tokens.token_expiry).getTime() : 0;

  if (tokens?.access_token && expiryMs - now > REFRESH_SKEW_MS) {
    return tokens.access_token;
  }

  // Need a refresh. Locate the encrypted refresh token.
  let encRefresh = tokens?.refresh_token_encrypted ?? null;
  if (!encRefresh) {
    const { data: conn } = await svc
      .from("drive_connection")
      .select("refresh_token_encrypted")
      .eq("id", true)
      .maybeSingle();
    encRefresh = conn?.refresh_token_encrypted ?? null;
  }
  if (!encRefresh) {
    throw new Error("No Drive connection / refresh token available");
  }

  const refreshToken = await decrypt(encRefresh);
  const fresh = await refreshAccessToken(refreshToken);
  const newExpiry = new Date(now + fresh.expires_in * 1000).toISOString();

  // Persist rotating token to drive_tokens (NOT to the locked connection row).
  await svc.from("drive_tokens").upsert({
    id: true,
    access_token: fresh.access_token,
    token_expiry: newExpiry,
    refresh_token_encrypted: encRefresh,
    updated_at: new Date().toISOString(),
  });

  return fresh.access_token;
}

// ---------------------------------------------------------------------------
// Drive REST helpers (thin wrappers over Drive API v3)
// ---------------------------------------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  webViewLink?: string;
  webContentLink?: string;
  modifiedTime?: string;
  trashed?: boolean;
}

export const FOLDER_MIME = "application/vnd.google-apps.folder";

async function driveFetch(
  accessToken: string,
  path: string,
  init: RequestInit = {},
  attempt = 0,
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${DRIVE_API}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });

  // Exponential backoff on 429 / 5xx (item 02).
  if ((res.status === 429 || res.status >= 500) && attempt < 4) {
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delayMs = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(1000 * 2 ** attempt, 16000);
    await new Promise((r) => setTimeout(r, delayMs));
    return driveFetch(accessToken, path, init, attempt + 1);
  }
  return res;
}

async function driveJson<T>(
  accessToken: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await driveFetch(accessToken, path, init);
  if (!res.ok) {
    // Never leak Google internals to clients; callers catch and translate.
    const text = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

const FILE_FIELDS =
  "id,name,mimeType,parents,size,webViewLink,webContentLink,modifiedTime,trashed";

/** Lists immediate children of a folder (non-trashed). */
export async function listChildren(
  accessToken: string,
  parentId: string,
  pageToken?: string,
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({
    q: `'${parentId}' in parents and trashed = false`,
    fields: `nextPageToken, files(${FILE_FIELDS})`,
    pageSize: "1000",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  if (pageToken) params.set("pageToken", pageToken);
  return driveJson(accessToken, `/files?${params}`);
}

/** Creates a folder under parentId; returns the new file. */
export async function createFolder(
  accessToken: string,
  name: string,
  parentId: string,
): Promise<DriveFile> {
  return driveJson(accessToken, `/files?fields=${FILE_FIELDS}&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
}

/** Creates a file's METADATA only (no content). Real content upload is a TODO. */
export async function createFileMetadata(
  accessToken: string,
  name: string,
  mimeType: string,
  parentId: string,
): Promise<DriveFile> {
  return driveJson(accessToken, `/files?fields=${FILE_FIELDS}&supportsAllDrives=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType, parents: [parentId] }),
  });
}

/**
 * Multipart upload of small base64 content. Adequate for small files only.
 * TODO: implement true RESUMABLE upload for large files
 * (https://developers.google.com/drive/api/guides/manage-uploads#resumable).
 * The frontend should switch to a resumable session for files > a few MB.
 */
export async function uploadSmallFile(
  accessToken: string,
  name: string,
  mimeType: string,
  parentId: string,
  contentBase64: string,
): Promise<DriveFile> {
  const boundary = `hexatech_${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, mimeType, parents: [parentId] });

  // Decode base64 content to bytes.
  const bin = atob(contentBase64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  const enc = new TextEncoder();
  const pre = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const post = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0);
  body.set(bytes, pre.length);
  body.set(post, pre.length + bytes.length);

  const url =
    `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`;
  const res = await driveFetch(accessToken, url, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive upload ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as DriveFile;
}

/** Fetches a single file's metadata. */
export async function getFile(
  accessToken: string,
  fileId: string,
): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: FILE_FIELDS,
    supportsAllDrives: "true",
  });
  return driveJson(accessToken, `/files/${fileId}?${params}`);
}

/** Trashes a file/folder (soft delete in Drive). */
export async function trashFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  await driveJson(accessToken, `/files/${fileId}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

/** Restores a trashed file/folder in Drive (sets trashed=false). */
export async function untrashFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  await driveJson(accessToken, `/files/${fileId}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: false }),
  });
}

/** Permanently deletes a file/folder. Prefer trashFile() for reversibility. */
export async function deleteFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  const res = await driveFetch(
    accessToken,
    `/files/${fileId}?supportsAllDrives=true`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`Drive delete ${res.status}`);
  }
}

/** Returns the starting page token for the Changes API (baseline cursor). */
export async function getStartPageToken(accessToken: string): Promise<string> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const data = await driveJson<{ startPageToken: string }>(
    accessToken,
    `/changes/startPageToken?${params}`,
  );
  return data.startPageToken;
}

export interface DriveChange {
  fileId: string;
  removed?: boolean;
  file?: DriveFile;
}

/** Lists changes since a page token (incremental sync). */
export async function changesList(
  accessToken: string,
  pageToken: string,
): Promise<{
  changes: DriveChange[];
  newStartPageToken?: string;
  nextPageToken?: string;
}> {
  const params = new URLSearchParams({
    pageToken,
    fields: `newStartPageToken, nextPageToken, changes(fileId, removed, file(${FILE_FIELDS}))`,
    pageSize: "1000",
    includeRemoved: "true",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  return driveJson(accessToken, `/changes?${params}`);
}

/** about.get — returns the connected account's email + storage info. */
export async function about(accessToken: string): Promise<{
  user?: { emailAddress?: string; displayName?: string };
}> {
  const params = new URLSearchParams({ fields: "user(emailAddress,displayName)" });
  return driveJson(accessToken, `/about?${params}`);
}

// ---------------------------------------------------------------------------
// Permissions API (item 04, Drive-native sharing)
// ---------------------------------------------------------------------------

export type DriveRole = "reader" | "commenter" | "writer";

/**
 * Translates our 6-level app PermLevel to one of Drive's 3 roles.
 * `no_access` → null (caller should revoke any existing Drive permission).
 *
 * The distinctions we encode but Drive doesn't have a 1:1 for:
 *   - `view` vs `view_download`: Drive `reader` always allows download in Drive
 *     UI; we enforce the no-download bit in OUR UI only.
 *   - `view_upload`: closest is `commenter` (read + comment, no add files via
 *     Drive UI). The app UI lets these users upload via our backend regardless.
 *   - `contributor` vs `full_control`: both become Drive `writer`. The
 *     manage-access capability is enforced by our app, not Drive's UI.
 */
export function permLevelToDriveRole(level: string): DriveRole | null {
  switch (level) {
    case "no_access":      return null;
    case "view":           return "reader";
    case "view_download":  return "reader";
    case "view_upload":    return "commenter";
    case "contributor":    return "writer";
    case "full_control":   return "writer";
    default:               return null;
  }
}

export interface DrivePermission {
  id: string;
  type: "user" | "group" | "domain" | "anyone";
  role: DriveRole | "owner" | "organizer" | "fileOrganizer";
  emailAddress?: string;
  displayName?: string;
}

/** Adds a user permission (sharing) on a Drive file/folder. Returns the new permission id. */
export async function addDrivePermission(
  accessToken: string,
  fileId: string,
  role: DriveRole,
  emailAddress: string,
): Promise<DrivePermission> {
  const params = new URLSearchParams({
    fields: "id, type, role, emailAddress, displayName",
    supportsAllDrives: "true",
    sendNotificationEmail: "false", // internal tool; no spammy invitation email
  });
  const body = { type: "user", role, emailAddress };
  return driveJson<DrivePermission>(
    accessToken,
    `/files/${fileId}/permissions?${params}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

/** Removes a Drive permission. Safe to call with a stale id - 404 is swallowed. */
export async function removeDrivePermission(
  accessToken: string,
  fileId: string,
  permissionId: string,
): Promise<void> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  const res = await driveFetch(
    accessToken,
    `/files/${fileId}/permissions/${permissionId}?${params}`,
    { method: "DELETE" },
  );
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    throw new Error(`Drive permission delete ${res.status}: ${text.slice(0, 200)}`);
  }
}

/** Lists all permissions on a file/folder (super-admin diagnostic / sync). */
export async function listDrivePermissions(
  accessToken: string,
  fileId: string,
): Promise<DrivePermission[]> {
  const params = new URLSearchParams({
    fields: "permissions(id, type, role, emailAddress, displayName)",
    pageSize: "100",
    supportsAllDrives: "true",
  });
  const data = await driveJson<{ permissions: DrivePermission[] }>(
    accessToken,
    `/files/${fileId}/permissions?${params}`,
  );
  return data.permissions ?? [];
}

/**
 * Find-or-create the company root folder by name at the connected account's
 * Drive root. Returns the folder id + name. Used by drive-oauth-callback (item 03).
 */
export async function findOrCreateRootFolder(
  accessToken: string,
  rootName: string,
): Promise<{ id: string; name: string }> {
  const params = new URLSearchParams({
    q: `name = '${rootName.replace(/'/g, "\\'")}' and mimeType = '${FOLDER_MIME}' and 'root' in parents and trashed = false`,
    fields: "files(id,name)",
    pageSize: "1",
  });
  const found = await driveJson<{ files: { id: string; name: string }[] }>(
    accessToken,
    `/files?${params}`,
  );
  if (found.files && found.files.length > 0) {
    return { id: found.files[0].id, name: found.files[0].name };
  }
  const created = await driveJson<DriveFile>(
    accessToken,
    `/files?fields=id,name`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: rootName, mimeType: FOLDER_MIME, parents: ["root"] }),
    },
  );
  return { id: created.id, name: created.name };
}
