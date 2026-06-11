"use client";

// User Management screen — now powered by TanStack React Query.
//
// Data: useUsers() + useDepartments() (in lib/queries/users.ts), which hit
//       the Next BFF routes GET /api/admin/users and GET /api/admin/departments.
//       The BFF holds the cookie session and talks to Supabase directly; the
//       browser never touches Edge Functions for these reads.
// Add:  useCreateUser() → POST /api/admin/users. On success it invalidates
//       the users cache, so the list refreshes automatically — no manual
//       refresh callback.
//
// Other row actions (edit / delete / change role / reset password / view
// activity / assign folders) still toast "coming soon" until their BFF
// routes + hooks land.

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Search, Plus, Filter, MoreVertical, Edit, Trash2,
  FolderOpen, KeyRound, UserCheck, UserX, Eye, ScanEye,
  ShieldCheck, CheckCircle, XCircle, X, RefreshCw, AlertTriangle,
} from "lucide-react";
import { UserEffectiveAccess } from "@/components/UserEffectiveAccess";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  useCreateUser, useDeleteUser, useDepartments,
  useResetUserPassword, useUpdateUserProfile, useUpdateUserRole, useUpdateUserStatus,
  useUsers,
} from "@/lib/queries/users";
import { useCanAct } from "@/lib/queries/tab-permissions";
import { Pagination, paginate } from "@/components/Pagination";
import { Loader, SkeletonRows } from "@/components/Loader";
import type { AppUser, Role } from "@/lib/types";

const ROLES: Role[] = ["super_admin", "admin", "manager", "team_lead", "lead_dev", "team_member"];

const ROLE_LABEL: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  team_lead: "Team Lead",
  lead_dev: "Lead Dev",
  team_member: "Team Member",
};

const ROLE_COLOR: Record<Role, { bg: string; text: string }> = {
  super_admin: { bg: "color-mix(in srgb, var(--brand-primary) 8%, transparent)", text: "var(--brand-primary)" },
  admin:       { bg: "color-mix(in srgb, var(--brand-accent) 8%, transparent)", text: "#9a7630" },
  manager:     { bg: "#3b82f615", text: "#1d4ed8" },
  team_lead:   { bg: "#8b5cf615", text: "#6d28d9" },
  lead_dev:    { bg: "#ec489915", text: "#be185d" },
  team_member: { bg: "#22c55e15", text: "#15803d" },
};

function randomPassword(len = 14): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
}

interface ModalProps { children: React.ReactNode; onClose: () => void; title: string; subtitle?: string; wide?: boolean }
function Modal({ children, onClose, title, subtitle, wide }: ModalProps) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ background: "white", borderRadius: "20px", padding: "32px", width: wide ? "720px" : "480px", maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)", position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: "absolute", top: "16px", right: "16px", background: "#f4f5f7", border: "none", borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <X size={15} color="#6b7280" />
        </button>
        <h3 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "18px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>{title}</h3>
        {subtitle && <p style={{ margin: "0 0 22px", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}

function FormField({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
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
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: "pointer", background: "white" };

interface NewUserForm {
  name: string;
  email: string;
  role: Role;
  departmentId: string;
  password: string;
}

const EMPTY_FORM: Omit<NewUserForm, "departmentId"> = {
  name: "", email: "", role: "admin", password: "",
};

export function UserManagement() {
  const { user: me } = useAuth();
  const router = useRouter();

  // React Query handles fetching, loading, errors and caching.
  // No manual useState/useEffect for users/departments.
  const usersQuery = useUsers();
  const departmentsQuery = useDepartments();
  const createUser = useCreateUser();
  const updateProfile = useUpdateUserProfile();
  const updateRole = useUpdateUserRole();
  const updateStatus = useUpdateUserStatus();
  const resetPassword = useResetUserPassword();
  const deleteUser = useDeleteUser();

  const users = useMemo(() => usersQuery.data ?? [], [usersQuery.data]);
  const departments = useMemo(() => departmentsQuery.data ?? [], [departmentsQuery.data]);
  const loading = usersQuery.isLoading || departmentsQuery.isLoading;
  const submitting = createUser.isPending;

  // Surface fetch errors via toast.
  useEffect(() => {
    if (usersQuery.error) toast.error((usersQuery.error as Error).message);
  }, [usersQuery.error]);
  useEffect(() => {
    if (departmentsQuery.error) toast.error((departmentsQuery.error as Error).message);
  }, [departmentsQuery.error]);

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<"All" | Role>("All");
  const [filterStatus, setFilterStatus] = useState<"All" | "active" | "inactive">("All");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  // Anchor coords for the currently-open row action menu, captured from the
  // trigger button's bounding rect. We render the dropdown via createPortal
  // so it escapes the table wrapper's overflow:hidden — otherwise the menu
  // gets clipped for users near the bottom of the page.
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  useEffect(() => { if (!openMenu) setMenuPos(null); }, [openMenu]);
  function openMenuFor(userId: string, anchor: HTMLElement) {
    if (openMenu === userId) { setOpenMenu(null); return; }
    const rect = anchor.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpenMenu(userId);
  }
  // Client-side pagination over the filtered list.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [addModal, setAddModal] = useState(false);
  const [form, setForm] = useState<NewUserForm>({ ...EMPTY_FORM, departmentId: "" });

  // Row-action state. Each is `null` when the corresponding dialog is closed,
  // or holds the user being acted on. Keeping them separate (instead of a
  // single discriminated union) keeps each form's submit handler simple.
  const [editUser, setEditUser] = useState<AppUser | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; avatar: string; googleEmail: string }>({ name: "", avatar: "", googleEmail: "" });
  const [roleUser, setRoleUser] = useState<AppUser | null>(null);
  const [roleForm, setRoleForm] = useState<{ role: Role; departmentId: string }>({ role: "admin", departmentId: "" });
  const [pwUser, setPwUser] = useState<AppUser | null>(null);
  const [pwValue, setPwValue] = useState("");
  const [statusUser, setStatusUser] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);
  // View Access modal — store the user ID only and resolve the live
  // UserWithPermissions from the users query on every render. That way, if a
  // grant changes in another tab while the modal is open (or between opens),
  // the modal reflects the latest cached state instead of a stale snapshot.
  const [accessUserId, setAccessUserId] = useState<string | null>(null);
  const accessUser = useMemo(
    () => (accessUserId ? users.find((u) => u.id === accessUserId) ?? null : null),
    [accessUserId, users],
  );

  const isSuperAdmin = me?.role === "super_admin";
  // Tab-permission gate. Lets non-super-admins with explicit user_management
  // action grant also manage users (Add / Edit / Delete). Super admins always
  // pass via the engine short-circuit.
  const canActUserMgmt = useCanAct("user_management");

  // Default the form's department to the first one once departments load -
  // but only for roles that actually need one. Super Admin / Admin have no
  // department; auto-setting it would put a stale dept id in the submit body.
  useEffect(() => {
    const roleNeedsDept = form.role !== "super_admin" && form.role !== "admin";
    if (!roleNeedsDept && form.departmentId) {
      setForm((p) => ({ ...p, departmentId: "" }));
      return;
    }
    if (roleNeedsDept && addModal && !form.departmentId && departments.length > 0) {
      setForm((p) => ({ ...p, departmentId: departments[0].id }));
    }
  }, [addModal, departments, form.departmentId, form.role]);

  const filtered = users.filter((u) => {
    const s = search.toLowerCase();
    const matchSearch = !s || u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s);
    const matchRole = filterRole === "All" || u.role === filterRole;
    const matchStatus = filterStatus === "All" || u.status === filterStatus;
    return matchSearch && matchRole && matchStatus;
  });

  // Snap to page 1 whenever the filter set changes so the user never sits on
  // an out-of-range page after narrowing the list.
  useEffect(() => { setPage(1); }, [search, filterRole, filterStatus]);
  const { pageItems: pageRows } = paginate(filtered, page, pageSize);

  const activeCount = users.filter((u) => u.status === "active").length;

  function resetForm() {
    setForm({ ...EMPTY_FORM, departmentId: departments[0]?.id ?? "" });
  }

  function closeAddModal() {
    if (submitting) return;
    setAddModal(false);
    resetForm();
  }

  function handleAddUser() {
    const name = form.name.trim();
    const email = form.email.trim().toLowerCase();
    // Super Admin and Admin do not belong to a department.
    const requiresDepartment = form.role !== "super_admin" && form.role !== "admin";
    if (!name) return toast.error("Name is required.");
    if (!email || !email.includes("@")) return toast.error("Please enter a valid email address.");
    if (requiresDepartment && !form.departmentId) return toast.error("Pick a department.");
    if (form.password.length < 8) return toast.error("Password must be at least 8 characters.");

    createUser.mutate(
      {
        name,
        email,
        role: form.role,
        departmentId: requiresDepartment ? form.departmentId : "",
        avatar: initialsFromName(name),
        password: form.password,
      },
      {
        onSuccess: () => {
          toast.success(`${name} created. Share their password securely.`);
          setAddModal(false);
          resetForm();
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  // ── Row actions ──────────────────────────────────────────────────────────
  // Each handler closes the row menu, then either opens a modal/confirm or
  // navigates to the appropriate screen. The actual mutations live inside the
  // modal/confirm submit handlers further down.

  function openEdit(user: AppUser) {
    setEditUser(user);
    setEditForm({
      name: user.name,
      avatar: user.avatar ?? initialsFromName(user.name),
      googleEmail: user.googleEmail ?? "",
    });
    setOpenMenu(null);
  }

  function openRole(user: AppUser) {
    setRoleUser(user);
    setRoleForm({
      role: user.role,
      departmentId: user.departmentId || (departments[0]?.id ?? ""),
    });
    setOpenMenu(null);
  }

  function openPassword(user: AppUser) {
    setPwUser(user);
    setPwValue("");
    setOpenMenu(null);
  }

  function openStatus(user: AppUser) {
    setStatusUser(user);
    setOpenMenu(null);
  }

  function openDelete(user: AppUser) {
    setDeleteTarget(user);
    setOpenMenu(null);
  }

  function goAssignFolders(user: AppUser) {
    // Routed to Folder Access Control; the query string lets that screen
    // pre-select this user on the "Users" tab.
    router.push(`/folders?principal=user&id=${encodeURIComponent(user.id)}`);
    setOpenMenu(null);
  }

  function goViewActivity(user: AppUser) {
    // Audit Logs filters by actorName via its existing search box, so we
    // hand it the user's name as a pre-filled search term.
    router.push(`/audit?actor=${encodeURIComponent(user.name)}`);
    setOpenMenu(null);
  }

  function submitEdit() {
    if (!editUser) return;
    const name = editForm.name.trim();
    const avatar = editForm.avatar.trim();
    const googleEmail = editForm.googleEmail.trim().toLowerCase();
    if (!name) return toast.error("Name is required.");
    if (googleEmail && !googleEmail.includes("@")) return toast.error("Invalid Google email.");
    updateProfile.mutate(
      { id: editUser.id, name, avatar: avatar || initialsFromName(name), googleEmail: googleEmail || null },
      {
        onSuccess: () => { toast.success(`${name} updated.`); setEditUser(null); },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  function submitRole() {
    if (!roleUser) return;
    const role = roleForm.role;
    const requiresDept = role !== "super_admin" && role !== "admin";
    const departmentId = requiresDept ? roleForm.departmentId : "";
    if (requiresDept && !departmentId) return toast.error("Pick a department.");
    updateRole.mutate(
      { id: roleUser.id, role, departmentId },
      {
        onSuccess: () => { toast.success(`Role updated to ${ROLE_LABEL[role]}.`); setRoleUser(null); },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  function submitPassword() {
    if (!pwUser) return;
    if (pwValue.length < 8) return toast.error("Password must be at least 8 characters.");
    resetPassword.mutate(
      { id: pwUser.id, password: pwValue },
      {
        onSuccess: () => {
          toast.success("Password reset. Share it with the user securely.");
          setPwUser(null);
          setPwValue("");
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  function submitStatus() {
    if (!statusUser) return;
    const next = statusUser.status === "active" ? "inactive" : "active";
    updateStatus.mutate(
      { id: statusUser.id, status: next },
      {
        onSuccess: () => {
          toast.success(`${statusUser.name} ${next === "active" ? "activated" : "deactivated"}.`);
          setStatusUser(null);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );
  }

  function submitDelete() {
    if (!deleteTarget) return;
    const t = deleteTarget;
    deleteUser.mutate(t.id, {
      onSuccess: () => { toast.success(`${t.name} deleted.`); setDeleteTarget(null); },
      onError: (e) => toast.error((e as Error).message),
    });
  }

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px" }}>
        <div>
          <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
            User Management
          </h2>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Loader size="sm" />
              <span className="loader-text-pulse" style={{ color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif", letterSpacing: "0.2px" }}>
                Loading users…
              </span>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
              {`${users.length} total user${users.length === 1 ? "" : "s"} · ${activeCount} active`}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            onClick={() => { void usersQuery.refetch(); void departmentsQuery.refetch(); }}
            disabled={loading || usersQuery.isFetching}
            title="Refresh"
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "10px 14px", background: "white", color: "#374151", border: "1.5px solid #e5e7eb", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: loading || usersQuery.isFetching ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", opacity: loading || usersQuery.isFetching ? 0.6 : 1 }}>
            <RefreshCw size={14} /> Refresh
          </button>
          {canActUserMgmt && (
            <button onClick={() => setAddModal(true)}
              style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 18px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 12px rgba(27,42,74,0.3)" }}>
              <Plus size={15} /> Add New User
            </button>
          )}
        </div>
      </div>

      <div style={{ background: "white", borderRadius: "14px", padding: "14px 18px", border: "1px solid #eef0f4", marginBottom: "18px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "220px" }}>
          <Search size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users by name or email..."
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 14px 9px 36px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", outline: "none", fontFamily: "'Poppins', sans-serif" }} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Filter size={14} color="#9ca3af" />
          <select value={filterRole} onChange={(e) => setFilterRole(e.target.value as "All" | Role)}
            style={{ padding: "8px 12px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", color: "#374151", outline: "none", fontFamily: "'Poppins', sans-serif", cursor: "pointer" }}>
            <option value="All">All roles</option>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as "All" | "active" | "inactive")}
            style={{ padding: "8px 12px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", color: "#374151", outline: "none", fontFamily: "'Poppins', sans-serif", cursor: "pointer" }}>
            <option value="All">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        {(search || filterRole !== "All" || filterStatus !== "All") && (
          <button onClick={() => { setSearch(""); setFilterRole("All"); setFilterStatus("All"); }}
            style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", gap: "4px" }}>
            <X size={12} /> Clear
          </button>
        )}
      </div>

      <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f9fc", borderBottom: "1px solid #eef0f4" }}>
              {["User", "Role", "Department", "Status", "Actions"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", fontWeight: 600, color: "#6b7280", letterSpacing: "0.5px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <SkeletonRows
                rows={8}
                columns={[
                  { variant: "avatar+text", width: "62%", height: 12 }, // User (avatar + name)
                  { variant: "pill", width: 90, height: 22 },           // Role
                  { width: "68%", height: 12 },                          // Department
                  { variant: "pill", width: 64, height: 22 },           // Status
                  { width: 28, height: 28, rounded: "md" },              // Actions (icon button)
                ]}
              />
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={5} style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                {users.length === 0 ? "No users yet. Click \"Add New User\" to add your first team member." : "No users found matching your filters."}
              </td></tr>
            )}
            {!loading && pageRows.map((user, i) => {
              const roleColor = ROLE_COLOR[user.role] ?? { bg: "#f4f5f7", text: "#374151" };
              const status = user.status ?? "active";
              return (
                <tr key={user.id} style={{ borderBottom: i < pageRows.length - 1 ? "1px solid #f9fafb" : "none" }}>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: status === "inactive" ? "#e5e7eb" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: status === "inactive" ? "#9ca3af" : "var(--brand-accent)", flexShrink: 0, fontFamily: "'Poppins', sans-serif" }}>
                        {(user.avatar || initialsFromName(user.name)).slice(0, 2)}
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, color: "var(--brand-primary)", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                          {user.name}{me && user.id === me.id ? " (You)" : ""}
                        </div>
                        <div style={{ color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>{user.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", background: roleColor.bg, color: roleColor.text }}>{ROLE_LABEL[user.role] ?? user.role}</span>
                  </td>
                  <td style={{ padding: "14px 16px", fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{user.departmentName || "—"}</td>
                  <td style={{ padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      {status === "active" ? <CheckCircle size={14} color="#22c55e" /> : <XCircle size={14} color="#ef4444" />}
                      <span style={{ fontSize: "12px", fontWeight: 500, color: status === "active" ? "#16a34a" : "#dc2626", fontFamily: "'Poppins', sans-serif" }}>
                        {status === "active" ? "Active" : "InActive"}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 16px" }}>
                    <div>
                      <button onClick={(e) => openMenuFor(user.id, e.currentTarget)}
                        style={{ width: "30px", height: "30px", borderRadius: "8px", border: "1px solid #eef0f4", background: "#f8f9fc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <MoreVertical size={14} color="#6b7280" />
                      </button>
                      {openMenu === user.id && menuPos && typeof document !== "undefined" && createPortal(
                        <div style={{ position: "fixed", top: menuPos.top, right: menuPos.right, width: "200px", background: "white", borderRadius: "12px", boxShadow: "0 16px 48px rgba(0,0,0,0.18)", border: "1px solid #eef0f4", zIndex: 1000, overflow: "hidden" }}>
                          {[
                            { icon: ScanEye, label: "View Access", action: () => { setAccessUserId(user.id); setOpenMenu(null); }, color: "var(--brand-primary)" },
                            { icon: Edit, label: "Edit User", action: () => openEdit(user), color: "#374151" },
                            { icon: FolderOpen, label: "Assign Folders", action: () => goAssignFolders(user), color: "#374151" },
                            { icon: ShieldCheck, label: "Change Role", action: () => openRole(user), color: "#374151" },
                            { icon: status === "active" ? UserX : UserCheck, label: status === "active" ? "Deactivate" : "Activate", action: () => openStatus(user), color: status === "active" ? "#ef4444" : "#22c55e" },
                            { icon: Eye, label: "View Activity", action: () => goViewActivity(user), color: "#374151" },
                            { icon: KeyRound, label: "Reset Password", action: () => openPassword(user), color: "#374151" },
                            { icon: Trash2, label: "Delete User", action: () => openDelete(user), color: "#ef4444" },
                          ].map((action, ai) => (
                            <button key={ai} onClick={action.action}
                              style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "9px 14px", background: "none", border: "none", cursor: "pointer", fontSize: "12px", color: action.color, fontFamily: "'Poppins', sans-serif", textAlign: "left" }}>
                              <action.icon size={13} color={action.color} />
                              {action.label}
                            </button>
                          ))}
                        </div>,
                        document.body
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={filtered.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            itemLabel="users"
          />
        )}
      </div>

      {addModal && (
        <Modal title="Add New User" subtitle="Create a profile and set their initial password. Share the password with them securely." onClose={closeAddModal}>
          <FormField label="Full Name">
            <input value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="Jane Doe" style={inputStyle} disabled={submitting} />
          </FormField>
          <FormField label="Email Address">
            <input value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} type="email" placeholder="jane@hexatech.io" style={inputStyle} disabled={submitting} />
          </FormField>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <FormField label="Role">
              <select value={form.role} onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as Role }))} style={selectStyle} disabled={submitting}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </FormField>
            <FormField label="Department">
              {form.role === "super_admin" || form.role === "admin" ? (
                <div style={{ padding: "10px 12px", background: "#f8f9fc", border: "1.5px solid #eef0f4", borderRadius: "10px", fontSize: "12.5px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
                  Not applicable — {form.role === "super_admin" ? "Super Admin" : "Admin"} has no department
                </div>
              ) : (
                <select value={form.departmentId} onChange={(e) => setForm((p) => ({ ...p, departmentId: e.target.value }))} style={selectStyle} disabled={submitting || departments.length === 0}>
                  {departments.length === 0 && <option value="">No departments — add one first</option>}
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </FormField>
          </div>

          <FormField label="Initial Password" hint="Minimum 8 characters. The user can change it after signing in.">
            <div style={{ display: "flex", gap: "8px" }}>
              <input type="text" value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} placeholder="Min 8 characters" style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }} disabled={submitting} />
              <button type="button" onClick={() => setForm((p) => ({ ...p, password: randomPassword() }))}
                style={{ padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
                Generate
              </button>
            </div>
          </FormField>

          <div style={{ display: "flex", gap: "10px", marginTop: "16px" }}>
            <button onClick={closeAddModal} disabled={submitting}
              style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: submitting ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>
              Cancel
            </button>
            <button onClick={handleAddUser} disabled={submitting}
              style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: submitting ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "Creating…" : "Create User"}
            </button>
          </div>
        </Modal>
      )}

      {/* Edit User — name, avatar (initials), and the Google email used for Drive sharing.
          Email/role/department are intentionally NOT editable here: email changes
          require touching auth.users separately, and role/dept live in their own
          dialog so the audit log entry tells the right story. */}
      {editUser && (
        <Modal title="Edit User" subtitle={`Update ${editUser.name}'s profile.`} onClose={() => updateProfile.isPending ? null : setEditUser(null)}>
          <FormField label="Full Name">
            <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} style={inputStyle} disabled={updateProfile.isPending} />
          </FormField>
          <FormField label="Initials" hint="Two characters shown in the avatar chip.">
            <input value={editForm.avatar} onChange={(e) => setEditForm((p) => ({ ...p, avatar: e.target.value.toUpperCase().slice(0, 2) }))} style={inputStyle} disabled={updateProfile.isPending} />
          </FormField>
          <FormField label="Google email" hint="Used for Google Drive sharing. Leave blank to use the login email.">
            <input value={editForm.googleEmail} onChange={(e) => setEditForm((p) => ({ ...p, googleEmail: e.target.value }))} type="email" placeholder={editUser.email} style={inputStyle} disabled={updateProfile.isPending} />
          </FormField>
          <div style={{ padding: "10px 12px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "11px", color: "#6b7280", marginBottom: "14px" }}>
            Login email: <strong>{editUser.email}</strong> (read-only)
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button onClick={() => setEditUser(null)} disabled={updateProfile.isPending}
              style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: updateProfile.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151" }}>Cancel</button>
            <button onClick={submitEdit} disabled={updateProfile.isPending}
              style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: updateProfile.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, opacity: updateProfile.isPending ? 0.7 : 1 }}>
              {updateProfile.isPending ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </Modal>
      )}

      {/* Change Role — role + department selection, mirrors the Add User form
          rules: super_admin/admin have no department, every other role does. */}
      {roleUser && (() => {
        const requiresDept = roleForm.role !== "super_admin" && roleForm.role !== "admin";
        const pending = updateRole.isPending;
        return (
          <Modal title="Change Role" subtitle={`Update ${roleUser.name}'s role and department.`} onClose={() => pending ? null : setRoleUser(null)}>
            <FormField label="Role">
              <select value={roleForm.role} onChange={(e) => setRoleForm((p) => ({ ...p, role: e.target.value as Role }))} style={selectStyle} disabled={pending}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </FormField>
            <FormField label="Department">
              {!requiresDept ? (
                <div style={{ padding: "10px 12px", background: "#f8f9fc", border: "1.5px solid #eef0f4", borderRadius: "10px", fontSize: "12.5px", color: "#9ca3af" }}>
                  Not applicable — {roleForm.role === "super_admin" ? "Super Admin" : "Admin"} has no department
                </div>
              ) : (
                <select value={roleForm.departmentId} onChange={(e) => setRoleForm((p) => ({ ...p, departmentId: e.target.value }))} style={selectStyle} disabled={pending || departments.length === 0}>
                  {departments.length === 0 && <option value="">No departments — add one first</option>}
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              )}
            </FormField>
            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button onClick={() => setRoleUser(null)} disabled={pending}
                style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: pending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151" }}>Cancel</button>
              <button onClick={submitRole} disabled={pending}
                style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: pending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, opacity: pending ? 0.7 : 1 }}>
                {pending ? "Updating…" : "Update Role"}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* Reset Password — super admin sets a new password; share it out-of-band. */}
      {pwUser && (
        <Modal title="Reset Password" subtitle={`Set a new password for ${pwUser.name}.`} onClose={() => resetPassword.isPending ? null : setPwUser(null)}>
          <FormField label="New Password" hint="Minimum 8 characters. Share it with the user securely.">
            <div style={{ display: "flex", gap: "8px" }}>
              <input type="text" value={pwValue} onChange={(e) => setPwValue(e.target.value)} placeholder="Min 8 characters" style={{ ...inputStyle, flex: 1, fontFamily: "monospace" }} disabled={resetPassword.isPending} />
              <button type="button" onClick={() => setPwValue(randomPassword())} disabled={resetPassword.isPending}
                style={{ padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "12px", fontWeight: 600, color: "#374151" }}>
                Generate
              </button>
            </div>
          </FormField>
          <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
            <button onClick={() => setPwUser(null)} disabled={resetPassword.isPending}
              style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: resetPassword.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151" }}>Cancel</button>
            <button onClick={submitPassword} disabled={resetPassword.isPending}
              style={{ flex: 2, padding: "12px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: resetPassword.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, opacity: resetPassword.isPending ? 0.7 : 1 }}>
              {resetPassword.isPending ? "Resetting…" : "Reset Password"}
            </button>
          </div>
        </Modal>
      )}

      {/* Activate / Deactivate confirm. */}
      {statusUser && (() => {
        const willDeactivate = statusUser.status === "active";
        const verb = willDeactivate ? "Deactivate" : "Activate";
        const accent = willDeactivate ? "#ef4444" : "#22c55e";
        return (
          <Modal title={`${verb} User`} subtitle={`This will ${verb.toLowerCase()} ${statusUser.name}'s account.`} onClose={() => updateStatus.isPending ? null : setStatusUser(null)}>
            <div style={{ padding: "12px 14px", background: willDeactivate ? "#fef2f2" : "#f0fdf4", border: `1px solid ${willDeactivate ? "#fecaca" : "#bbf7d0"}`, borderRadius: "10px", display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "14px" }}>
              <AlertTriangle size={16} color={accent} style={{ flexShrink: 0, marginTop: "2px" }} />
              <span style={{ fontSize: "12.5px", color: willDeactivate ? "#991b1b" : "#15803d", lineHeight: 1.5 }}>
                {willDeactivate
                  ? "An inactive user cannot sign in. Their grants remain in place and will take effect again on reactivation."
                  : "The user will be able to sign in again immediately."}
              </span>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => setStatusUser(null)} disabled={updateStatus.isPending}
                style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: updateStatus.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151" }}>Cancel</button>
              <button onClick={submitStatus} disabled={updateStatus.isPending}
                style={{ flex: 2, padding: "12px", background: accent, color: "white", border: "none", borderRadius: "10px", cursor: updateStatus.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, opacity: updateStatus.isPending ? 0.7 : 1 }}>
                {updateStatus.isPending ? "Saving…" : verb}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* View Access modal — shows the user's effective folder + tab grants
          split by source. Read-only. Renders off the cached grants we already
          have in the users query (no extra fetch). When admins change a role
          grant in Folder Access Control or Tab Access Control, the mutation
          invalidates the users query so the next open shows fresh state. */}
      {accessUser && (
        <Modal
          title={`Access for ${accessUser.name}`}
          subtitle="Inherited (via role + department) and direct grants."
          onClose={() => setAccessUserId(null)}
          wide
        >
          <UserEffectiveAccess userId={accessUser.id} preloaded={accessUser} />
        </Modal>
      )}

      {/* Delete confirm — destructive; requires typing the user's name to enable. */}
      {deleteTarget && (
        <Modal title="Delete User" subtitle="This permanently removes the account and audit-logs the action." onClose={() => deleteUser.isPending ? null : setDeleteTarget(null)}>
          <div style={{ padding: "12px 14px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "10px", display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "14px" }}>
            <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: "2px" }} />
            <span style={{ fontSize: "12.5px", color: "#991b1b", lineHeight: 1.5 }}>
              <strong>{deleteTarget.name}</strong> ({deleteTarget.email}) will be deleted. This cannot be undone.
            </span>
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            <button onClick={() => setDeleteTarget(null)} disabled={deleteUser.isPending}
              style={{ flex: 1, padding: "12px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: deleteUser.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, color: "#374151" }}>Cancel</button>
            <button onClick={submitDelete} disabled={deleteUser.isPending}
              style={{ flex: 2, padding: "12px", background: "#ef4444", color: "white", border: "none", borderRadius: "10px", cursor: deleteUser.isPending ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, opacity: deleteUser.isPending ? 0.7 : 1 }}>
              {deleteUser.isPending ? "Deleting…" : "Delete User"}
            </button>
          </div>
        </Modal>
      )}

      {openMenu && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 999 }} onClick={() => setOpenMenu(null)} />,
        document.body
      )}
    </div>
  );
}
