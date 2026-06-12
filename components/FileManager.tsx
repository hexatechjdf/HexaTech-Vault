"use client";

// File Manager — Phase A + parent-folder picker.
//
// Talks to the Next BFF (/api/admin/drive/*) via React Query hooks. The browser
// never touches Drive directly.
//
// New folder UX: the modal shows where the folder WILL be created and lets the
// super_admin reach any other parent via the inline <FolderPicker /> — which is
// just a second useDriveList(parentId) traversal, no new endpoint needed.
//
// Each folder/file row also has an "Open in Drive" link in its menu so the
// super_admin can verify the item exists in the actual Google Drive account
// without copying IDs out of the DB.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Upload, FolderPlus, FileText, Folder as FolderIcon, ChevronRight,
  RefreshCw, MoreVertical, Trash2, Download, X, ExternalLink, ArrowLeft, Check,
  Undo2, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/queries/branding";
import {
  useDriveList,
  useCreateFolder,
  useUploadFile,
  useDeleteItem,
  useDownloadLink,
  useSyncNow,
  useMyFolders,
  useTrash,
  useRestoreItem,
  usePurgeItem,
  useCloneProposal,
  type TrashItem,
} from "@/lib/queries/drive-files";
import { useCanAct } from "@/lib/queries/tab-permissions";
import { useDepartments } from "@/lib/queries/users";
import { Pagination } from "@/components/Pagination";
import { Loader, SkeletonRows } from "@/components/Loader";
import type { FileDTO, FolderDTO, PermLevel, Role } from "@/lib/types";
import { capabilities } from "@/lib/permissions";

interface FileManagerProps { role?: Role }

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5 MB — base64-in-JSON cap for now.

function humanSize(bytes: number | null | undefined): string {
  if (!bytes && bytes !== 0) return "—";
  if (bytes === 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function driveFolderUrl(driveFileId: string): string {
  return `https://drive.google.com/drive/folders/${driveFileId}`;
}

function driveFileUrl(file: FileDTO): string {
  return file.webViewLink || `https://drive.google.com/file/d/${file.driveFileId}/view`;
}

interface PickedParent {
  id: string;
  name: string;
  /** Slash-joined breadcrumb of the picked parent so the user sees the full path. */
  path: string;
}

export function FileManager(_props: FileManagerProps) {
  const { user: me } = useAuth();
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const list = useDriveList(currentFolderId);
  const createFolder = useCreateFolder();
  const uploadFile = useUploadFile();
  const deleteItem = useDeleteItem();
  const downloadLink = useDownloadLink();
  const sync = useSyncNow();

  // Fallback: when the caller can't access the company root (typical for any
  // non-super-admin role), drive-list at folderId=null returns 403. We then
  // hit /api/admin/drive/my-folders (which calls shared-with-me) and surface
  // the user's directly-granted folders as a flat "My Folders" view.
  const couldntListRoot = currentFolderId === null && !list.isLoading && !!list.error;
  const myFoldersQuery = useMyFolders(couldntListRoot);
  const myFoldersMode = couldntListRoot;

  const folders = myFoldersMode
    ? (myFoldersQuery.data ?? [])
    : (list.data?.folders ?? []);
  const files = myFoldersMode ? [] : (list.data?.files ?? []);

  // Combined paginated view over folders + files: folders appear first, then
  // files. pageFolders + pageFiles each cover the slice of this combined list
  // that lands in the current page. Either may be empty depending on where
  // the cursor falls.
  const totalItems = folders.length + files.length;
  // Note: page state is declared further down with other modal/UI state.
  const breadcrumb = myFoldersMode
    ? [{ id: "__my-folders__", name: "My Folders" }]
    : (list.data?.breadcrumb ?? []);
  const currentFolder = myFoldersMode ? undefined : breadcrumb[breadcrumb.length - 1];
  const currentPath = breadcrumb.map((b) => b.name).join(" / ");

  // The Clone action is enabled only when the user is inside a folder named
  // exactly "Proposal" (case-insensitive). This is the convention the CRM
  // department picked - extending to other departments later only requires
  // each department to create a folder called "Proposal".
  const isInProposalFolder =
    !myFoldersMode && (currentFolder?.name?.trim().toLowerCase() === "proposal");
  // `proposalLabel` derived from the branding query is declared further down
  // (right after useBranding() runs) so the variable is referenced after the
  // hook that defines `branding`. See the Trash/Clone modal-state block.

  // Caller's REAL effective level on the folder they're currently looking at.
  // Source of truth is the backend (drive-list returns `myLevelHere`). Falls
  // back to no_access on initial load or on the My-Folders virtual view where
  // there is no "current folder" yet. Super Admin short-circuits to
  // full_control on the client side too so action buttons appear instantly
  // without waiting for the listing response.
  const myLevelHere = useMemo<PermLevel>(() => {
    if (me?.role === "super_admin") return "full_control";
    if (myFoldersMode) return "no_access";
    return (list.data?.myLevelHere as PermLevel) ?? "no_access";
  }, [me?.role, myFoldersMode, list.data?.myLevelHere]);
  const cap = capabilities(myLevelHere);
  // Super Admins own the system; they pass every gate without needing any
  // grant. Short-circuit at the COMPONENT level so the buttons light up
  // regardless of folder-level capability state OR the tab access query
  // (which may still be loading on first paint).
  const isSuperAdmin = me?.role === "super_admin";
  // Non-super-admins need BOTH gates true:
  //   1) Folder capability (do they have enough on the current folder?)
  //   2) Tab capability (do they have action access on File Manager at all?)
  // Server-side BFF re-checks the same.
  const canActFileManager = useCanAct("file_manager");
  const canCreate = isSuperAdmin || (cap.canCreateSubfolder && canActFileManager);
  const canUpload = isSuperAdmin || (cap.canUpload && canActFileManager);

  // ─── Modal state ──────────────────────────────────────────────────────────
  // Super Admin and Admin do not belong to any department, but every folder
  // still has an owner department. For those roles we show a department picker
  // in the New Folder modal; for every other role we auto-use their own.
  const isDeptlessRole = me?.role === "super_admin" || me?.role === "admin";
  // `isSuperAdmin` is declared above next to the canCreate/canUpload gates;
  // we reuse it here for the Delete + Restore + Trash modal affordances,
  // which are Super-Admin-only and live outside the permission system.
  const departmentsQuery = useDepartments();
  const [pickedOwnerDept, setPickedOwnerDept] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  // Trash modal (Super Admin only) - shows soft-deleted items + Restore/Purge.
  const [trashOpen, setTrashOpen] = useState(false);
  const trash = useTrash(trashOpen && isSuperAdmin);
  const restoreItem = useRestoreItem();
  const purgeItem = usePurgeItem();
  // Clone Proposal modal — appears on the file menu only when the current
  // folder is named "Proposal". Lets the user spin off a new project folder
  // (Client - Project - <proposal_label>) and copy the sample into it.
  const branding = useBranding();
  const cloneProposal = useCloneProposal();
  const [cloneTarget, setCloneTarget] = useState<FileDTO | null>(null);
  const [cloneClient, setCloneClient] = useState("");
  const [cloneProject, setCloneProject] = useState("");
  // Live preview of the cloned folder name. Derived once the branding query
  // resolves; falls back to "JDF Proposal" until then.
  const proposalLabel = branding.data?.proposalLabel?.trim() || "JDF Proposal";
  // Client-side pagination over the combined folders + files listing in the
  // current folder. Snaps back to page 1 every time navigation lands on a
  // different folder (handled by the useEffect on currentFolderId below).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [newFolderName, setNewFolderName] = useState("");
  const [pickedParent, setPickedParent] = useState<PickedParent | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: "folder"; folder: FolderDTO }
    | { kind: "file"; file: FileDTO }
    | null
  >(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Anchor coords for the currently-open action menu, captured from the
  // trigger button's bounding rect when the user clicks it. We render the
  // dropdown via createPortal so it escapes the table wrapper's overflow:hidden
  // clip — otherwise the menu disappears on the bottom rows.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  // Whenever the menu closes (any caller calling setOpenMenu(null)), clear
  // the coords so a re-open starts from a clean slate.
  useEffect(() => { if (!openMenu) setMenuPos(null); }, [openMenu]);
  function openMenuFor(key: string, anchor: HTMLElement) {
    if (openMenu === key) { setOpenMenu(null); return; }
    const rect = anchor.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenu(key);
  }
  const uploadRef = useRef<HTMLInputElement>(null);

  // Reset to page 1 every time we navigate to a different folder (or flip
  // into / out of "My Folders" fallback mode), so the user never starts on a
  // stale out-of-range page.
  useEffect(() => { setPage(1); }, [currentFolderId, myFoldersMode]);

  // Slice the combined folders + files list to the current page. Folders are
  // always rendered before files, so the slice walks folders first and then
  // spills over into files. Either pageFolders or pageFiles may be empty.
  const pageStart = (page - 1) * pageSize;
  const pageEnd = pageStart + pageSize;
  const pageFolders = folders.slice(
    Math.min(pageStart, folders.length),
    Math.min(pageEnd, folders.length),
  );
  const fileStart = Math.max(0, pageStart - folders.length);
  const fileEnd = Math.max(0, pageEnd - folders.length);
  const pageFiles = files.slice(fileStart, fileEnd);

  // When the New Folder modal opens, default the parent to the current folder.
  useEffect(() => {
    if (createOpen && !pickedParent && currentFolder) {
      setPickedParent({ id: currentFolder.id, name: currentFolder.name, path: currentPath });
    }
  }, [createOpen, pickedParent, currentFolder, currentPath]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  function navigateTo(folderId: string | null) {
    setCurrentFolderId(folderId);
    setOpenMenu(null);
  }

  function closeCreateModal() {
    if (createFolder.isPending) return;
    setCreateOpen(false);
    setNewFolderName("");
    setPickedParent(null);
    setPickedOwnerDept("");
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) { toast.error("Folder name is required"); return; }
    if (!pickedParent) { toast.error("Pick a parent folder first"); return; }
    // Source the owner department: Super Admin / Admin pick it in the modal
    // (they don't belong to a department themselves); everyone else uses their
    // own department automatically.
    const ownerDepartmentId = isDeptlessRole ? pickedOwnerDept : me?.departmentId;
    if (!ownerDepartmentId) {
      toast.error(isDeptlessRole
        ? "Pick an owner department for this folder"
        : "Your account has no department - ask an admin to set one");
      return;
    }
    try {
      await createFolder.mutateAsync({
        parentFolderId: pickedParent.id,
        name,
        ownerDepartmentId,
      });
      toast.success(`Folder "${name}" created in ${pickedParent.path}`);
      closeCreateModal();
    } catch (e) {
      toast.error((e as Error).message || "Create failed");
    }
  }

  async function handleUploadFiles(filesPicked: FileList | null) {
    if (!filesPicked || filesPicked.length === 0) return;
    if (!currentFolder) { toast.error("Wait for the listing to load"); return; }

    for (const file of Array.from(filesPicked)) {
      if (file.size > MAX_UPLOAD_BYTES) {
        toast.error(`${file.name} is over the 5 MB upload limit`);
        continue;
      }
      try {
        toast.loading(`Uploading ${file.name}…`, { id: `up-${file.name}` });
        const contentBase64 = await readFileAsBase64(file);
        await uploadFile.mutateAsync({
          folderId: currentFolder.id,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          contentBase64,
        });
        toast.success(`${file.name} uploaded`, { id: `up-${file.name}` });
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`, { id: `up-${file.name}` });
      }
    }
    if (uploadRef.current) uploadRef.current.value = "";
  }

  async function handleDeleteConfirmed() {
    if (!deleteTarget) return;
    try {
      const id = deleteTarget.kind === "folder" ? deleteTarget.folder.id : deleteTarget.file.id;
      const name = deleteTarget.kind === "folder" ? deleteTarget.folder.name : deleteTarget.file.name;
      await deleteItem.mutateAsync({ id, kind: deleteTarget.kind });
      toast.success(`${name} moved to Trash`);
      setDeleteTarget(null);
    } catch (e) {
      toast.error((e as Error).message || "Delete failed");
    }
  }

  async function handleDownload(file: FileDTO) {
    setOpenMenu(null);
    try {
      const r = await downloadLink.mutateAsync(file.id);
      const url = r.webContentLink || r.webViewLink;
      if (!url) { toast.error("No download link available"); return; }
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Failed to get download link");
    }
  }

  function closeCloneModal() {
    if (cloneProposal.isPending) return;
    setCloneTarget(null);
    setCloneClient("");
    setCloneProject("");
  }

  async function handleCloneConfirmed() {
    if (!cloneTarget) return;
    const client = cloneClient.trim();
    const project = cloneProject.trim();
    if (!client) { toast.error("Client name is required"); return; }
    if (!project) { toast.error("Project title is required"); return; }
    try {
      const r = await cloneProposal.mutateAsync({
        sourceFileId: cloneTarget.id,
        clientName: client,
        projectTitle: project,
      });
      toast.success(`Created "${r.folder.name}"`);
      setCloneTarget(null);
      setCloneClient("");
      setCloneProject("");
      // Drop the user straight into the new project folder so they can open
      // the cloned file immediately.
      navigateTo(r.folder.id);
    } catch (e) {
      toast.error((e as Error).message || "Failed to clone the proposal");
    }
  }

  async function handleSync() {
    try {
      const r = await sync.mutateAsync();
      toast.success(`Synced — ${r.added} added, ${r.updated} updated, ${r.removed} removed`);
    } catch (e) {
      toast.error((e as Error).message || "Sync failed");
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  const loading = myFoldersMode ? myFoldersQuery.isLoading : list.isLoading;
  // In my-folders mode the underlying list.error is the "no access at root"
  // signal that triggered the fallback — that's expected, not user-facing.
  // Only surface the my-folders query's own error (or list's, in normal mode).
  const errored = myFoldersMode
    ? (myFoldersQuery.error as Error | null)
    : (list.error as Error | null);

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
            File Manager
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
            {breadcrumb.length === 0 && loading && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Loader size="sm" />
                <span className="loader-text-pulse" style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", letterSpacing: "0.2px" }}>
                  Loading folders…
                </span>
              </div>
            )}
            {breadcrumb.length === 0 && !loading && !errored && (
              <span style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
                Drive index is empty — click Sync below to pull the latest from Drive.
              </span>
            )}
            {breadcrumb.map((b, i) => (
              <span key={b.id} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <button onClick={() => navigateTo(i === 0 ? null : b.id)}
                  style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: "12px", color: i === breadcrumb.length - 1 ? "var(--brand-primary)" : "#6b7280", fontFamily: "'Poppins', sans-serif", fontWeight: i === breadcrumb.length - 1 ? 600 : 400 }}>
                  {b.name}
                </button>
                {i < breadcrumb.length - 1 && <ChevronRight size={11} color="#d1d5db" />}
              </span>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button onClick={handleSync} disabled={sync.isPending}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", background: "white", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: sync.isPending ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: sync.isPending ? 0.6 : 1 }}>
            <RefreshCw size={14} /> {sync.isPending ? "Syncing…" : "Sync"}
          </button>
          {isSuperAdmin && (
            <button onClick={() => setTrashOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", background: "white", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
              <Trash2 size={14} /> Trash
            </button>
          )}
          {canCreate && (
            <button
              onClick={() => {
                // Super Admins are never gated by "is a folder open"; if there's
                // no current folder we explain why and let them act instead of
                // silently disabling the button.
                if (!currentFolder) {
                  toast.error(isSuperAdmin
                    ? "Open a folder first, or connect Google Drive in Settings if you haven't yet."
                    : "Open a folder first.");
                  return;
                }
                setCreateOpen(true);
              }}
              disabled={createFolder.isPending || (!currentFolder && !isSuperAdmin)}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", background: "white", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: (createFolder.isPending || (!currentFolder && !isSuperAdmin)) ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: (!currentFolder && !isSuperAdmin) ? 0.5 : 1 }}>
              <FolderPlus size={14} /> New folder
            </button>
          )}
          {canUpload && (
            <>
              <input ref={uploadRef} type="file" multiple style={{ display: "none" }}
                onChange={(e) => handleUploadFiles(e.target.files)} />
              <button
                onClick={() => {
                  if (!currentFolder) {
                    toast.error(isSuperAdmin
                      ? "Open a folder first, or connect Google Drive in Settings if you haven't yet."
                      : "Open a folder first.");
                    return;
                  }
                  uploadRef.current?.click();
                }}
                disabled={uploadFile.isPending || (!currentFolder && !isSuperAdmin)}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 16px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: (uploadFile.isPending || (!currentFolder && !isSuperAdmin)) ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: (!currentFolder && !isSuperAdmin) ? 0.6 : 1 }}>
                <Upload size={14} /> {uploadFile.isPending ? "Uploading…" : "Upload"}
              </button>
            </>
          )}
        </div>
      </div>

      {errored && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "12px 16px", marginBottom: "18px", color: "#dc2626", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          {errored.message}
        </div>
      )}

      {/* Listing */}
      <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f9fc", borderBottom: "1px solid #eef0f4" }}>
              {["Name", "Size", "Modified", ""].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "10px", fontWeight: 600, color: "#6b7280", letterSpacing: "0.5px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <SkeletonRows
                rows={8}
                columns={[
                  { variant: "avatar+text", width: "55%", height: 12 }, // Name (folder/file icon + label)
                  { width: "45%", height: 10 },                          // Size
                  { width: "60%", height: 10 },                          // Modified
                  { width: 28, height: 28, rounded: "md" },              // Action
                ]}
              />
            )}
            {!loading && !errored && folders.length === 0 && files.length === 0 && (
              <tr><td colSpan={4} style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                {myFoldersMode
                  ? "No folders have been shared with you yet. Ask your Super Admin to grant access."
                  : "This folder is empty."}
              </td></tr>
            )}
            {!loading && pageFolders.map((f, i) => (
              <tr key={`folder-${f.id}`} style={{ borderBottom: i < pageFolders.length - 1 || pageFiles.length > 0 ? "1px solid #f9fafb" : "none", cursor: "pointer" }}
                onClick={() => navigateTo(f.id)}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafbfd")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <FolderIcon size={16} color="var(--brand-accent)" />
                    <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{f.name}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>
                  {typeof f.itemCount === "number"
                    ? `${f.itemCount} ${f.itemCount === 1 ? "item" : "items"}`
                    : "—"}
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>
                  {f.updatedAt ? formatTime(f.updatedAt) : "—"}
                </td>
                <td style={{ padding: "12px 16px" }} onClick={(e) => e.stopPropagation()}>
                  <button onClick={(e) => openMenuFor(`folder-${f.id}`, e.currentTarget)}
                    style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid #eef0f4", background: "#f8f9fc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MoreVertical size={13} color="#6b7280" />
                  </button>
                  {openMenu === `folder-${f.id}` && menuPos && typeof document !== "undefined" && createPortal(
                    <div style={{ position: "fixed", top: menuPos.top, right: menuPos.right, width: "180px", background: "white", borderRadius: "10px", boxShadow: "0 12px 32px rgba(0,0,0,0.18)", border: "1px solid #eef0f4", zIndex: 1000, overflow: "hidden" }}>
                      <a href={driveFolderUrl(f.driveFileId)} target="_blank" rel="noopener noreferrer"
                        onClick={() => setOpenMenu(null)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", textAlign: "left", textDecoration: "none", boxSizing: "border-box" }}>
                        <ExternalLink size={12} /> Open in Drive
                      </a>
                      {isSuperAdmin && (
                        <button onClick={() => { setDeleteTarget({ kind: "folder", folder: f }); setOpenMenu(null); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#ef4444", fontFamily: "'Poppins', sans-serif", textAlign: "left" }}>
                          <Trash2 size={12} /> Delete folder
                        </button>
                      )}
                    </div>,
                    document.body
                  )}
                </td>
              </tr>
            ))}
            {!loading && pageFiles.map((f, i) => (
              <tr key={`file-${f.id}`} style={{ borderBottom: i < pageFiles.length - 1 ? "1px solid #f9fafb" : "none" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#fafbfd")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <td style={{ padding: "12px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <FileText size={16} color="#6b7280" />
                    <span style={{ fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{f.name}</span>
                  </div>
                </td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>{humanSize(f.sizeBytes)}</td>
                <td style={{ padding: "12px 16px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>{formatTime(f.modifiedAt)}</td>
                <td style={{ padding: "12px 16px" }}>
                  <button onClick={(e) => openMenuFor(`file-${f.id}`, e.currentTarget)}
                    style={{ width: "28px", height: "28px", borderRadius: "8px", border: "1px solid #eef0f4", background: "#f8f9fc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <MoreVertical size={13} color="#6b7280" />
                  </button>
                  {openMenu === `file-${f.id}` && menuPos && typeof document !== "undefined" && createPortal(
                    <div style={{ position: "fixed", top: menuPos.top, right: menuPos.right, width: "190px", background: "white", borderRadius: "10px", boxShadow: "0 12px 32px rgba(0,0,0,0.18)", border: "1px solid #eef0f4", zIndex: 1000, overflow: "hidden" }}>
                      {/* Open — opens the file in Google Drive's web viewer
                          (read or edit depending on permission). Distinct from
                          Download which fetches a direct-download link. */}
                      <a href={driveFileUrl(f)} target="_blank" rel="noopener noreferrer"
                        onClick={() => setOpenMenu(null)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", textAlign: "left", textDecoration: "none", boxSizing: "border-box" }}>
                        <ExternalLink size={12} /> Open
                      </a>
                      <button onClick={() => handleDownload(f)}
                        style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", textAlign: "left" }}>
                        <Download size={12} /> Download
                      </button>
                      {isInProposalFolder && (
                        <button
                          onClick={() => { if (!canCreate) return; setCloneTarget(f); setOpenMenu(null); }}
                          disabled={!canCreate}
                          aria-disabled={!canCreate}
                          title={!canCreate ? "You do not have access to take actions" : undefined}
                          style={{
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "9px 14px",
                            background: "none",
                            border: "none",
                            cursor: canCreate ? "pointer" : "not-allowed",
                            fontSize: "12px",
                            color: canCreate ? "var(--brand-primary)" : "#9ca3af",
                            fontFamily: "'Poppins', sans-serif",
                            textAlign: "left",
                            fontWeight: 600,
                            opacity: canCreate ? 1 : 0.6,
                          }}
                        >
                          <Copy size={12} /> Clone
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button onClick={() => { setDeleteTarget({ kind: "file", file: f }); setOpenMenu(null); }}
                          style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: "#ef4444", fontFamily: "'Poppins', sans-serif", textAlign: "left" }}>
                          <Trash2 size={12} /> Delete file
                        </button>
                      )}
                    </div>,
                    document.body
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && totalItems > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={totalItems}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            itemLabel="items"
          />
        )}
      </div>

      {/* Click-outside catcher for context menus — portaled to body so it sits
          above the table and below the menu (which is also portaled at z 1000). */}
      {openMenu && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setOpenMenu(null)} />,
        document.body
      )}

      {/* New Folder modal */}
      {createOpen && (
        <Modal title="New folder" onClose={closeCreateModal}>
          <Field label="Folder name">
            <input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
              placeholder="e.g. Custom Development Department"
              style={inputStyle} />
          </Field>

          <Field label="Parent folder" hint="Where the new folder will be created.">
            <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "#f9fafb" }}>
              <FolderIcon size={14} color="var(--brand-accent)" />
              <span style={{ flex: 1, fontSize: "13px", color: "#1f2937", fontFamily: "'Poppins', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                title={pickedParent?.path ?? ""}>
                {pickedParent?.path ?? "—"}
              </span>
              <button type="button" onClick={() => setPickerOpen(true)}
                style={{ padding: "4px 10px", border: "1px solid #d1d5db", borderRadius: "8px", background: "white", cursor: "pointer", fontSize: "11px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>
                Change
              </button>
            </div>
          </Field>

          {isDeptlessRole && (
            <Field label="Owner department" hint="Which department owns this folder. Super Admin and Admin don't belong to a department, so pick the right one for this folder.">
              <select
                value={pickedOwnerDept}
                onChange={(e) => setPickedOwnerDept(e.target.value)}
                style={{ ...inputStyle, cursor: "pointer", background: "white" }}
                disabled={createFolder.isPending || departmentsQuery.isLoading || (departmentsQuery.data?.length ?? 0) === 0}>
                <option value="">
                  {departmentsQuery.isLoading
                    ? "Loading departments…"
                    : (departmentsQuery.data?.length ?? 0) === 0
                      ? "No departments — add one in User Management"
                      : "Pick an owner department…"}
                </option>
                {(departmentsQuery.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Field>
          )}

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <button onClick={closeCreateModal} disabled={createFolder.isPending}
              style={{ flex: 1, padding: "11px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: createFolder.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
              Cancel
            </button>
            <button onClick={handleCreateFolder} disabled={createFolder.isPending || !pickedParent || !newFolderName.trim() || (isDeptlessRole && !pickedOwnerDept)}
              style={{ flex: 2, padding: "11px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: createFolder.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: (createFolder.isPending || !pickedParent || !newFolderName.trim() || (isDeptlessRole && !pickedOwnerDept)) ? 0.7 : 1 }}>
              {createFolder.isPending ? "Creating…" : "Create folder"}
            </button>
          </div>
        </Modal>
      )}

      {/* Folder picker (stacked on top of New Folder modal) */}
      {pickerOpen && (
        <FolderPicker
          initialFolderId={pickedParent?.id ?? currentFolderId}
          onCancel={() => setPickerOpen(false)}
          onSelect={(picked) => {
            setPickedParent(picked);
            setPickerOpen(false);
          }}
        />
      )}

      {/* Delete confirm modal */}
      {deleteTarget && (
        <Modal title={`Delete ${deleteTarget.kind}?`} onClose={() => setDeleteTarget(null)}>
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 14px", marginBottom: "16px" }}>
            <p style={{ margin: 0, fontSize: "12.5px", color: "#dc2626", fontFamily: "'Poppins', sans-serif", lineHeight: 1.5 }}>
              <strong>
                {deleteTarget.kind === "folder" ? deleteTarget.folder.name : deleteTarget.file.name}
              </strong> will be moved to Google Drive&apos;s Trash. You can recover it from Drive within 30 days.
            </p>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setDeleteTarget(null)}
              style={{ flex: 1, padding: "11px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
              Cancel
            </button>
            <button onClick={handleDeleteConfirmed} disabled={deleteItem.isPending}
              style={{ flex: 1, padding: "11px", background: "#ef4444", color: "white", border: "none", borderRadius: "10px", cursor: deleteItem.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: deleteItem.isPending ? 0.7 : 1 }}>
              {deleteItem.isPending ? "Deleting…" : "Move to Trash"}
            </button>
          </div>
        </Modal>
      )}

      {/* Clone Proposal modal — only reachable when the current folder is
          named "Proposal" and the user picks a sample file. */}
      {cloneTarget && (
        <Modal title={`Clone "${cloneTarget.name}"`} onClose={closeCloneModal}>
          <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", lineHeight: 1.55 }}>
            A new project folder will be created here and the selected sample will be copied into it. Folder name follows the convention <strong>Client &middot; Project &middot; {proposalLabel}</strong>.
          </p>
          <Field label="Client Name" hint="The end client / customer this proposal is for.">
            <input value={cloneClient} onChange={(e) => setCloneClient(e.target.value)}
              autoFocus
              placeholder="e.g. Jeff Bear"
              maxLength={100}
              disabled={cloneProposal.isPending}
              style={inputStyle} />
          </Field>
          <Field label="Project Title" hint="A short title for the project. Same client may have many projects, so make it distinctive.">
            <input value={cloneProject} onChange={(e) => setCloneProject(e.target.value)}
              placeholder="e.g. LogoQRCodeGenerator"
              maxLength={120}
              disabled={cloneProposal.isPending}
              onKeyDown={(e) => { if (e.key === "Enter") void handleCloneConfirmed(); }}
              style={inputStyle} />
          </Field>
          <div style={{ padding: "12px 14px", background: "#fafbfc", border: "1px dashed #e5e7eb", borderRadius: "10px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "4px" }}>Folder will be named</div>
            <div style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
              {(cloneClient.trim() || "Client")} &nbsp;-&nbsp; {(cloneProject.trim() || "Project")} &nbsp;-&nbsp; {proposalLabel}
            </div>
            <div style={{ fontSize: "10px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase", margin: "10px 0 4px" }}>File will be named</div>
            <div style={{ color: "var(--brand-primary)", fontWeight: 600 }}>
              {(cloneClient.trim() || "Client")} &nbsp;-&nbsp; {(cloneProject.trim() || "Project")} &nbsp;-&nbsp; {proposalLabel} Proposal - Master Doc
            </div>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={closeCloneModal} disabled={cloneProposal.isPending}
              style={{ flex: 1, padding: "11px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: cloneProposal.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
              Cancel
            </button>
            <button onClick={handleCloneConfirmed}
              disabled={cloneProposal.isPending || !cloneClient.trim() || !cloneProject.trim()}
              style={{ flex: 2, padding: "11px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: (cloneProposal.isPending || !cloneClient.trim() || !cloneProject.trim()) ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: (cloneProposal.isPending || !cloneClient.trim() || !cloneProject.trim()) ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
              {cloneProposal.isPending ? (
                <><Loader size="sm" /> Cloning…</>
              ) : (
                <><Copy size={14} /> Create &amp; Clone</>
              )}
            </button>
          </div>
        </Modal>
      )}

      {/* Trash (Super-Admin-only): list of soft-deleted items + Restore + Delete forever. */}
      {trashOpen && isSuperAdmin && (
        <TrashModal
          items={trash.data?.items ?? []}
          retentionDays={trash.data?.retentionDays ?? 30}
          loading={trash.isLoading}
          errorMsg={trash.error ? (trash.error as Error).message : null}
          restoring={restoreItem.isPending ? restoreItem.variables : null}
          purging={purgeItem.isPending ? purgeItem.variables : null}
          onRestore={async (item) => {
            try {
              await restoreItem.mutateAsync({ id: item.id, kind: item.kind });
              toast.success(`Restored ${item.kind} "${item.name}"`);
            } catch (e) {
              toast.error((e as Error).message || "Restore failed");
            }
          }}
          onPurge={async (item) => {
            try {
              await purgeItem.mutateAsync({ id: item.id, kind: item.kind });
              toast.success(`Permanently deleted "${item.name}"`);
            } catch (e) {
              toast.error((e as Error).message || "Permanent delete failed");
            }
          }}
          onClose={() => setTrashOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Folder picker ──────────────────────────────────────────────────────────
// Stacked modal. Reuses useDriveList to walk the tree — no new endpoint needed.
// The user clicks a folder to navigate INTO it, then clicks "Select this folder"
// to choose the currently-displayed folder as parent.
function FolderPicker({
  initialFolderId,
  onSelect,
  onCancel,
}: {
  initialFolderId: string | null;
  onSelect: (picked: PickedParent) => void;
  onCancel: () => void;
}) {
  const [folderId, setFolderId] = useState<string | null>(initialFolderId);
  const list = useDriveList(folderId);
  const subfolders = list.data?.folders ?? [];
  const breadcrumb = list.data?.breadcrumb ?? [];
  const current = breadcrumb[breadcrumb.length - 1];
  const path = breadcrumb.map((b) => b.name).join(" / ");
  const loading = list.isLoading;

  return (
    <Modal title="Pick a parent folder" onClose={onCancel}>
      {/* Breadcrumb / current location */}
      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px", padding: "10px 12px", background: "#f8f9fc", borderRadius: "10px", border: "1px solid #eef0f4", overflow: "hidden" }}>
        {breadcrumb.length > 1 && (
          <button onClick={() => {
            const parent = breadcrumb[breadcrumb.length - 2];
            setFolderId(breadcrumb.length === 2 ? null : parent.id);
          }}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 8px", background: "white", border: "1px solid #e5e7eb", borderRadius: "6px", cursor: "pointer", fontSize: "11px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
            <ArrowLeft size={11} /> Up
          </button>
        )}
        <span style={{ flex: 1, fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={path}>
          {path || "Loading…"}
        </span>
      </div>

      {/* Subfolder list */}
      <div style={{ maxHeight: "260px", overflowY: "auto", border: "1px solid #eef0f4", borderRadius: "10px", background: "white" }}>
        {loading && (
          <div style={{ padding: "20px", textAlign: "center", fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>Loading…</div>
        )}
        {!loading && subfolders.length === 0 && (
          <div style={{ padding: "20px", textAlign: "center", fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
            No subfolders here.
          </div>
        )}
        {!loading && subfolders.map((f, i) => (
          <button key={f.id} onClick={() => setFolderId(f.id)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "none", border: "none", borderBottom: i < subfolders.length - 1 ? "1px solid #f9fafb" : "none", cursor: "pointer", fontSize: "13px", color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", textAlign: "left" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "#fafbfd")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
            <FolderIcon size={14} color="var(--brand-accent)" />
            <span style={{ flex: 1, fontWeight: 500 }}>{f.name}</span>
            <ChevronRight size={12} color="#9ca3af" />
          </button>
        ))}
      </div>

      <p style={{ margin: "10px 2px 16px", fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
        Click a folder to navigate inside, or pick the current location below.
      </p>

      <div style={{ display: "flex", gap: "10px" }}>
        <button onClick={onCancel}
          style={{ flex: 1, padding: "11px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
          Cancel
        </button>
        <button onClick={() => current && onSelect({ id: current.id, name: current.name, path })} disabled={!current}
          style={{ flex: 2, padding: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: current ? "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))" : "#9ca3af", color: "white", border: "none", borderRadius: "10px", cursor: current ? "pointer" : "not-allowed", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: current ? 1 : 0.6 }}>
          <Check size={14} /> Pick &ldquo;{current?.name ?? "…"}&rdquo;
        </button>
      </div>
    </Modal>
  );
}

// ─── Generic modal ──────────────────────────────────────────────────────────
function Modal({ title, onClose, children, width = 460 }: { title: string; onClose: () => void; children: React.ReactNode; width?: number | string }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: "20px", padding: "28px", width: typeof width === "number" ? `${width}px` : width, maxWidth: "95vw", boxShadow: "0 24px 80px rgba(0,0,0,0.25)", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "#f4f5f7", border: "none", borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={15} color="#6b7280" />
        </button>
        <h3 style={{ margin: "0 0 18px", color: "var(--brand-primary)", fontSize: "16px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "14px" }}>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px", fontFamily: "'Poppins', sans-serif" }}>{label}</label>
      {children}
      {hint && <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1.5px solid #e5e7eb",
  borderRadius: "10px", fontSize: "13px", outline: "none", fontFamily: "'Poppins', sans-serif", color: "#1f2937", background: "#f9fafb",
};

// ─── Trash modal (Super-Admin-only) ─────────────────────────────────────────
// Lists every soft-deleted folder / file currently in the recovery window.
// Each row shows where it lived, when it was deleted, and how many days
// remain before the retention cron permanently purges it.

function TrashModal({
  items, retentionDays, loading, errorMsg, restoring, purging, onRestore, onPurge, onClose,
}: {
  items: TrashItem[];
  retentionDays: number;
  loading: boolean;
  errorMsg: string | null;
  restoring: { id: string; kind: "folder" | "file" } | null | undefined;
  purging: { id: string; kind: "folder" | "file" } | null | undefined;
  onRestore: (item: TrashItem) => void | Promise<void>;
  onPurge: (item: TrashItem) => void | Promise<void>;
  onClose: () => void;
}) {
  // Inline two-step confirm for permanent delete - safer than firing on the
  // first click. Click "Delete forever" once -> button text changes to
  // "Confirm forever"; click again to fire. "Cancel" backs out.
  const [confirmPurgeKey, setConfirmPurgeKey] = useState<string | null>(null);
  return (
    <Modal title={`Trash (${items.length})`} onClose={onClose} width={715}>
      <p style={{ margin: "0 0 14px", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>
        Soft-deleted items stay recoverable for <strong>{retentionDays} days</strong>. After that the retention cron purges them permanently.
      </p>
      {loading && (
        <Loader fullCenter text="Loading Trash…" style={{ minHeight: "180px" }} />
      )}
      {!loading && errorMsg && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", padding: "12px 16px", color: "#dc2626", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          {errorMsg}
        </div>
      )}
      {!loading && !errorMsg && items.length === 0 && (
        <div style={{ padding: "24px", textAlign: "center", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          Trash is empty. Nothing to restore.
        </div>
      )}
      {!loading && !errorMsg && items.length > 0 && (
        <div className="brand-scroll" style={{ maxHeight: "60vh", overflowY: "auto", marginBottom: "12px", paddingRight: "6px" }}>
          {items.map((item, idx) => {
            const daysSince = (Date.now() - new Date(item.deletedAt).getTime()) / 86_400_000;
            const daysRemaining = Math.max(0, Math.ceil(retentionDays - daysSince));
            const isThisRestoring = restoring?.id === item.id && restoring?.kind === item.kind;
            return (
              <div key={`${item.kind}-${item.id}`}
                style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 8px", borderBottom: idx < items.length - 1 ? "1px solid #f1f3f7" : "none" }}>
                {item.kind === "folder"
                  ? <FolderIcon size={18} color="var(--brand-accent)" />
                  : <FileText size={18} color="#6b7280" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.name}
                  </div>
                  {item.path && (
                    <div title={item.path}
                      style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.path}
                    </div>
                  )}
                </div>
                <div style={{ fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", textAlign: "right", whiteSpace: "nowrap" }}>
                  <div>Deleted {new Date(item.deletedAt).toLocaleDateString()}</div>
                  <div style={{ color: daysRemaining <= 3 ? "#ef4444" : "#9ca3af" }}>
                    {daysRemaining === 0 ? "Purges today" : `${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                  <button onClick={() => onRestore(item)} disabled={isThisRestoring}
                    style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", background: "white", color: "var(--brand-primary)", border: "1.5px solid var(--brand-accent)", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: isThisRestoring ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: isThisRestoring ? 0.6 : 1 }}>
                    <Undo2 size={12} /> {isThisRestoring ? "Restoring…" : "Restore"}
                  </button>
                  {(() => {
                    const itemKey = `${item.kind}:${item.id}`;
                    const isThisPurging = purging?.id === item.id && purging?.kind === item.kind;
                    const isConfirming = confirmPurgeKey === itemKey;
                    if (isConfirming) {
                      return (
                        <>
                          <button onClick={() => setConfirmPurgeKey(null)} disabled={isThisPurging}
                            style={{ padding: "7px 10px", background: "white", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                            Cancel
                          </button>
                          <button onClick={async () => { await onPurge(item); setConfirmPurgeKey(null); }} disabled={isThisPurging}
                            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", background: "#ef4444", color: "white", border: "none", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: isThisPurging ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: isThisPurging ? 0.6 : 1 }}>
                            <Trash2 size={12} /> {isThisPurging ? "Deleting…" : "Confirm forever"}
                          </button>
                        </>
                      );
                    }
                    return (
                      <button onClick={() => setConfirmPurgeKey(itemKey)} disabled={isThisPurging || isThisRestoring}
                        title="Permanently delete - cannot be undone"
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", background: "white", color: "#ef4444", border: "1.5px solid #fecaca", borderRadius: "8px", fontSize: "12px", fontWeight: 600, cursor: (isThisPurging || isThisRestoring) ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: (isThisPurging || isThisRestoring) ? 0.6 : 1 }}>
                        <Trash2 size={12} /> Delete forever
                      </button>
                    );
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={onClose}
          style={{ padding: "9px 18px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
          Close
        </button>
      </div>
    </Modal>
  );
}

