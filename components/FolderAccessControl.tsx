"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import {
  Folder, FolderOpen, ChevronRight, ChevronDown, User, Briefcase, Info, Building2,
  ScanEye, ShieldCheck, X,
} from "lucide-react";
import { toast } from "sonner";
import type { PermLevel, PrincipalType, Role } from "@/lib/types";
import { PERM_LABELS, PERM_COLORS, PERM_LEVELS } from "@/lib/permissions";
// React Query — single batch fetch replaces the previous N+1 pattern that
// triggered ~13 drive-list and ~13 permissions-get round-trips on page load.
import { useAccessTree, useSetPermission, type AccessTreeGrant } from "@/lib/queries/permissions";
import { useUsers, useDepartments, type UserWithPermissions } from "@/lib/queries/users";
import { useCanAct } from "@/lib/queries/tab-permissions";
import { UserEffectiveAccess } from "@/components/UserEffectiveAccess";

/** Sentinel value used by the scope picker to mean "no department scope" — the
 *  grant applies to every user with the selected role across every department.
 *  We can't use an empty string in a <select> reliably (some browsers treat it
 *  as "the first option"), so a fixed token is safer. */
const SCOPE_ALL = "__all__";

// Item 4: per-folder permission assignment. Permissions are NEVER global — each grant is tied to one
// folder. Default is "No Access". Granting access to N folders requires N separate selections.

interface FolderNode {
  id: string;
  name: string;
  children: FolderNode[];
}

// Super Admin is not a grantable role - they own the company Drive and have
// full_control everywhere by definition. Listing them here would let an
// admin try to "grant" something to super_admin, which is meaningless.
const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "team_lead", label: "Team Lead" },
  { value: "lead_dev", label: "Lead Dev" },
  { value: "team_member", label: "Team Member" },
];

// (Removed: recursive loadTree() walker.)
// The previous implementation called backend.list(folderId) for EVERY folder in
// the tree sequentially, producing ~13 round-trips for a ~13-folder tree. This
// was followed by a parallel fan-out of N permissions-get requests (one per
// folder), totalling ~28 HTTP calls before the page could render.
//
// Replaced by:
//   - One GET /api/admin/folders/access-tree (Postgres-only, no Drive calls).
//   - Tree built client-side from the flat folders[] array by parent_id.
//   - Grants grouped client-side by folderId.
// See lib/queries/permissions.ts -> useAccessTree() and the buildTree useMemo
// inside FolderAccessControl below.

type RowLevelSource = "direct" | "ancestor_user" | "role_dept" | "role_unscoped" | "ancestor_role_dept" | "ancestor_role_unscoped" | "none";

const SOURCE_BADGE: Record<RowLevelSource, { label: string; bg: string; fg: string } | null> = {
  direct: null,
  ancestor_user: { label: "inherited", bg: "#fef3c7", fg: "#92400e" },
  role_dept: { label: "role + dept", bg: "#dbeafe", fg: "#1e3a8a" },
  role_unscoped: { label: "role", bg: "#e0e7ff", fg: "#3730a3" },
  ancestor_role_dept: { label: "inherited · role+dept", bg: "#dbeafe", fg: "#1e3a8a" },
  ancestor_role_unscoped: { label: "inherited · role", bg: "#e0e7ff", fg: "#3730a3" },
  none: null,
};

function FolderRow({
  node, depth, levelFor, sourceFor, onChange, expanded, onToggle, pending, canAct,
}: {
  node: FolderNode;
  depth: number;
  levelFor: (folderId: string) => PermLevel;
  sourceFor: (folderId: string) => RowLevelSource;
  onChange: (folderId: string, level: PermLevel) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  pending: Set<string>;
  /** False = render rows read-only (level dropdown disabled). */
  canAct: boolean;
}) {
  const perm = levelFor(node.id);
  const source = sourceFor(node.id);
  const badge = SOURCE_BADGE[source];
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.id);
  const isPending = pending.has(node.id);

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 12px", borderRadius: "10px", marginBottom: "2px", background: perm !== "no_access" ? `${PERM_COLORS[perm]}08` : "transparent", border: `1px solid ${perm !== "no_access" ? PERM_COLORS[perm] + "20" : "transparent"}`, paddingLeft: `${12 + depth * 20}px` }}>
        <button onClick={() => hasChildren && onToggle(node.id)} style={{ background: "none", border: "none", cursor: hasChildren ? "pointer" : "default", padding: "0 4px 0 0", color: "#9ca3af", display: "flex", alignItems: "center" }}>
          {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: "14px" }} />}
        </button>
        {isExpanded ? (
          <FolderOpen size={15} color="var(--brand-accent)" style={{ marginRight: "8px", flexShrink: 0 }} />
        ) : (
          <Folder size={15} color={perm !== "no_access" ? PERM_COLORS[perm] : "#9ca3af"} style={{ marginRight: "8px", flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, fontSize: "13px", color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", fontWeight: depth === 0 ? 600 : 400 }}>
          {node.name}
        </span>
        {badge && (
          <span
            title="This level is inherited. Picking a new value here creates a per-user grant on this folder that overrides the inherited one."
            style={{ marginRight: "8px", padding: "2px 7px", borderRadius: "999px", background: badge.bg, color: badge.fg, fontSize: "9.5px", fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}
          >
            {badge.label}
          </span>
        )}
        <span
          className={isPending ? "pending-border-trace" : undefined}
          style={isPending ? { ["--trace-color" as string]: "#10b981" } : undefined}
        >
          {isPending && (
            <svg className="pending-border-trace-svg" aria-hidden="true">
              <rect x="0" y="0" width="100%" height="100%" rx="8" ry="8" pathLength="100" />
            </svg>
          )}
          <select
            value={perm}
            onChange={(e) => canAct && onChange(node.id, e.target.value as PermLevel)}
            disabled={isPending || !canAct}
            aria-busy={isPending}
            title={!canAct ? "View-only access on Folder Access Control" : undefined}
            style={{ padding: "4px 10px", borderRadius: "8px", border: `1.5px solid ${PERM_COLORS[perm]}40`, background: `${PERM_COLORS[perm]}10`, color: PERM_COLORS[perm], fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", outline: "none", cursor: (!canAct ? "not-allowed" : (isPending ? "wait" : "pointer")), display: "block" }}
          >
            {PERM_LEVELS.map((val) => (
              <option key={val} value={val}>{PERM_LABELS[val]}</option>
            ))}
          </select>
        </span>
      </div>
      {hasChildren && isExpanded && node.children.map((child) => (
        <FolderRow key={child.id} node={child} depth={depth + 1} levelFor={levelFor} sourceFor={sourceFor} onChange={onChange} expanded={expanded} onToggle={onToggle} pending={pending} canAct={canAct} />
      ))}
    </>
  );
}

export function FolderAccessControl() {
  // Optional "deep link" used by User Management's "Assign Folders" action:
  // ?principal=user&id=<userId>  → land on the Users tab with that user picked.
  // ?principal=role&id=<roleKey> → land on the Roles tab with that role picked.
  // Validated against the loaded options once data is in.
  const searchParams = useSearchParams();
  const initialPrincipalType = searchParams?.get("principal") === "role" ? "role" : "user";
  const initialPrincipalId = searchParams?.get("id") ?? "";

  // ─── Data layer (React Query, single batch fetch) ────────────────────────
  const accessTreeQuery = useAccessTree();
  const usersQuery = useUsers();
  const departmentsQuery = useDepartments();
  const setPermission = useSetPermission();
  // Tab gate. View-only callers see the tree populated (so they can read
  // who has what), but every level dropdown is disabled.
  const canActFolderAccess = useCanAct("folder_access");
  const loading = accessTreeQuery.isLoading || usersQuery.isLoading || departmentsQuery.isLoading;

  // Surface fetch errors as toasts — once per failure.
  useEffect(() => {
    if (accessTreeQuery.error) toast.error((accessTreeQuery.error as Error).message || "Failed to load folder permissions.");
  }, [accessTreeQuery.error]);

  // Super admins are excluded from the grantable user list - they own the
  // Drive and have full_control everywhere by definition.
  const users = useMemo(
    () => (usersQuery.data ?? []).filter((u) => u.role !== "super_admin"),
    [usersQuery.data],
  );
  const departments = departmentsQuery.data ?? [];

  // Derive the nested folder tree + grants-by-folder map from the flat batch
  // response. Both are pure JS over the cached query data — no extra fetches.
  const { tree, grantsByFolder, parentOf, rootFolderId } = useMemo(() => {
    if (!accessTreeQuery.data) {
      return {
        tree: [] as FolderNode[],
        grantsByFolder: {} as Record<string, AccessTreeGrant[]>,
        parentOf: new Map<string, string | null>(),
        rootFolderId: null as string | null,
      };
    }
    const folders = accessTreeQuery.data.folders;
    const grantsData = accessTreeQuery.data.grants;

    // parent_id -> child folders. Skip the synthetic root (is_root === true);
    // we render its CHILDREN as the top-level tree, never the root itself.
    const childrenOf = new Map<string | null, typeof folders>();
    const parentOfMap = new Map<string, string | null>();
    let rootId: string | null = null;
    for (const f of folders) {
      parentOfMap.set(f.id, f.parent_id);
      if (f.is_root) {
        rootId = f.id;
        continue;
      }
      const key = f.parent_id;
      if (!childrenOf.has(key)) childrenOf.set(key, []);
      childrenOf.get(key)!.push(f);
    }

    function build(parentId: string | null): FolderNode[] {
      return (childrenOf.get(parentId) ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        children: build(f.id),
      }));
    }
    const builtTree = build(rootId);

    // Group active grants by folder for O(1) lookup in levelFor().
    const map: Record<string, AccessTreeGrant[]> = {};
    for (const g of grantsData) {
      if (!map[g.folderId]) map[g.folderId] = [];
      map[g.folderId].push(g);
    }
    return { tree: builtTree, grantsByFolder: map, parentOf: parentOfMap, rootFolderId: rootId };
  }, [accessTreeQuery.data]);

  const [principalType, setPrincipalType] = useState<PrincipalType>(initialPrincipalType);
  const [principalId, setPrincipalId] = useState<string>("");
  /** Department scope for role grants. `null` = "All departments" (unscoped, the
   *  default behaviour). A real dept id narrows the grant to users with the
   *  current role AND that department. Always null when principalType==='user'. */
  const [principalDeptId, setPrincipalDeptId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  // One-time initialisation once the data hooks have resolved: resolve the
  // deep-link principal id against the loaded options (or fall back to the
  // first), and auto-expand top-level folders.
  const initRef = useRef(false);
  useEffect(() => {
    if (initRef.current) return;
    if (loading) return;
    setExpanded(new Set(tree.map((n) => n.id)));
    let resolved = "";
    if (initialPrincipalType === "user" && initialPrincipalId
        && users.some((u) => u.id === initialPrincipalId)) {
      resolved = initialPrincipalId;
    } else if (initialPrincipalType === "role" && initialPrincipalId
        && ROLES.some((r) => r.value === initialPrincipalId)) {
      resolved = initialPrincipalId;
    } else if (initialPrincipalType === "user") {
      resolved = users[0]?.id ?? "";
    } else {
      resolved = ROLES[0]?.value ?? "";
    }
    setPrincipalId(resolved);
    initRef.current = true;
  }, [loading, tree, users, initialPrincipalType, initialPrincipalId]);

  // Effective resolution for the selected principal on a folder.
  //
  // - Role view: the dropdown reflects the role's explicit grant at THIS
  //   folder for the chosen department scope. Role grants don't inherit
  //   from ancestors — admins set them per-folder — so no walk is needed.
  //
  // - User view: walks the ancestor chain user-wins, matching the SQL
  //   `get_effective_level()` semantics. At every node we check for a
  //   per-user grant first (no_access wins as explicit revocation), then
  //   the user's role + department, then the role unscoped. The first
  //   match decides the effective level. Without this walk the right
  //   pane would always show "no_access" for users whose access comes
  //   from role grants — which is the bug the user reported.
  type LevelSource = "direct" | "ancestor_user" | "role_dept" | "role_unscoped" | "ancestor_role_dept" | "ancestor_role_unscoped" | "none";
  type LevelResolution = { level: PermLevel; source: LevelSource; viaFolderId: string | null };

  const resolveLevel = (folderId: string): LevelResolution => {
    if (principalType === "role") {
      const g = (grantsByFolder[folderId] ?? []).find((x) =>
        x.principalType === "role"
        && x.principalId === principalId
        && (x.principalDeptId ?? null) === principalDeptId,
      );
      return g ? { level: g.level as PermLevel, source: "direct", viaFolderId: folderId } : { level: "no_access", source: "none", viaFolderId: null };
    }

    // User view: walk nearest-ancestor first, user-wins.
    const user = userById.get(principalId);
    if (!user) return { level: "no_access", source: "none", viaFolderId: null };

    let current: string | null = folderId;
    let depth = 0;
    while (current !== null && current !== rootFolderId) {
      const grants = grantsByFolder[current] ?? [];

      const userG = grants.find((x) => x.principalType === "user" && x.principalId === user.id);
      if (userG) {
        return {
          level: userG.level as PermLevel,
          source: depth === 0 ? "direct" : "ancestor_user",
          viaFolderId: current,
        };
      }
      if (user.departmentId) {
        const rdG = grants.find((x) => x.principalType === "role" && x.principalId === user.role && x.principalDeptId === user.departmentId);
        if (rdG) {
          return {
            level: rdG.level as PermLevel,
            source: depth === 0 ? "role_dept" : "ancestor_role_dept",
            viaFolderId: current,
          };
        }
      }
      const ruG = grants.find((x) => x.principalType === "role" && x.principalId === user.role && x.principalDeptId === null);
      if (ruG) {
        return {
          level: ruG.level as PermLevel,
          source: depth === 0 ? "role_unscoped" : "ancestor_role_unscoped",
          viaFolderId: current,
        };
      }
      current = parentOf.get(current) ?? null;
      depth += 1;
    }
    return { level: "no_access", source: "none", viaFolderId: null };
  };

  const levelFor = (folderId: string): PermLevel => resolveLevel(folderId).level;
  const sourceFor = (folderId: string): LevelSource => resolveLevel(folderId).source;

  const handleChange = async (folderId: string, level: PermLevel) => {
    if (!principalId) return;
    // No optimistic update — UI state only changes on success. If the server rejects
    // (e.g. 422 from permissions-set: "...isn't a Google account..."), the controlled
    // <select> snaps back to the previous level on its own because the access-tree
    // query data hasn't been touched. The API's `error` field is surfaced via the
    // toast. On success, useSetPermission invalidates the access-tree query and
    // React Query refetches in the background — derived `grantsByFolder`
    // automatically picks up the new value.
    setPending((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
    try {
      await setPermission.mutateAsync({
        folderId,
        principalType,
        principalId,
        // User grants force dept to null; role grants pass the selected scope
        // (null when "All departments" is picked).
        principalDeptId: principalType === "user" ? null : principalDeptId,
        level,
      });
      toast.success(`Permission updated: ${PERM_LABELS[level]}`);
    } catch (e) {
      toast.error((e as Error).message || "Could not update permission.");
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(folderId);
        return next;
      });
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const principalName = (() => {
    if (principalType === "user") return users.find((u) => u.id === principalId)?.name ?? "—";
    const roleLabel = ROLES.find((r) => r.value === principalId)?.label ?? "—";
    // Decorate role headers so super admins always see WHICH slot they're
    // editing — "Team Member · CRM" vs "Team Member · All departments".
    if (principalDeptId) {
      const deptName = departments.find((d) => d.id === principalDeptId)?.name ?? "—";
      return `${roleLabel} · ${deptName}`;
    }
    return `${roleLabel} · All departments`;
  })();

  // The list of selectable principals for the active tab.
  const principalOptions: { id: string; label: string; sub: string; avatar?: string }[] =
    principalType === "user"
      ? users.map((u) => ({ id: u.id, label: u.name, sub: u.departmentName, avatar: u.avatar }))
      : ROLES.map((r) => ({ id: r.value, label: r.label, sub: "Role" }));

  // User-permissions panel — shown on the Users tab so the super admin can
  // glance at every user's effective access without leaving this screen.
  // Source of truth is `useUsers()`, which now embeds the full grant
  // breakdown per user (folder + tab, direct + role-inherited).
  const userById = useMemo(() => {
    const map = new Map<string, UserWithPermissions>();
    for (const u of users as UserWithPermissions[]) map.set(u.id, u);
    return map;
  }, [users]);

  // Which user's effective-access detail is open (null = closed). Stored as
  // an id so the live UserWithPermissions can be looked up on each render —
  // a grant change elsewhere refetches `users` and the modal reflects it.
  const [viewAccessFor, setViewAccessFor] = useState<string | null>(null);
  const viewAccessUser = viewAccessFor ? userById.get(viewAccessFor) ?? null : null;

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700 }}>Folder Access Control</h2>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px" }}>
          Assign permissions per folder. Each grant applies to a single folder — access is never granted globally.
        </p>
      </div>

      {/* Principal-type tabs (Department removed - now user + role only). */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {([
          { t: "user" as PrincipalType, label: "Users", icon: User },
          { t: "role" as PrincipalType, label: "Roles", icon: Briefcase },
        ]).map(({ t, label, icon: Icon }) => {
          const active = principalType === t;
          return (
            <button key={t} onClick={() => {
              setPrincipalType(t);
              const first = t === "user" ? users[0]?.id : ROLES[0].value;
              setPrincipalId(first ?? "");
              // Always reset to the unscoped slot when switching tabs/principals
              // — the user almost certainly wants the most common case.
              setPrincipalDeptId(null);
            }}
              style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 16px", borderRadius: "10px", border: `1.5px solid ${active ? "var(--brand-accent)" : "#e5e7eb"}`, background: active ? "color-mix(in srgb, var(--brand-accent) 7%, transparent)" : "white", color: active ? "var(--brand-primary)" : "#6b7280", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
              <Icon size={14} color={active ? "var(--brand-accent)" : "#9ca3af"} /> {label}
            </button>
          );
        })}
      </div>

      {/* Scope picker — visible only when granting to a role. Lets the super
          admin restrict the role grant to a single department, which is the
          core of the role × department model from migration 0021. The default
          ("All departments") keeps the prior behaviour for back-compat. */}
      {principalType === "role" && !loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", padding: "10px 14px", background: "color-mix(in srgb, var(--brand-accent) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-accent) 18%, transparent)", borderRadius: "12px" }}>
          <Building2 size={14} color="var(--brand-accent)" />
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>
            Scope:
          </span>
          <select
            value={principalDeptId ?? SCOPE_ALL}
            onChange={(e) => setPrincipalDeptId(e.target.value === SCOPE_ALL ? null : e.target.value)}
            style={{ padding: "6px 12px", borderRadius: "8px", border: "1.5px solid #e5e7eb", background: "white", fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", outline: "none", cursor: "pointer" }}
          >
            <option value={SCOPE_ALL}>All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <span style={{ fontSize: "11px", color: "#6b7280", marginLeft: "auto" }}>
            {principalDeptId
              ? "Only users with this role in the selected department will be granted."
              : "Reaches every user with this role across every department."}
          </span>
        </div>
      )}

      {loading ? (
        <div style={{ color: "#9ca3af", fontSize: "13px" }}>Loading folders and permissions…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "18px" }}>
          {/* Principal list */}
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden", height: "fit-content", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #f4f5f7", fontSize: "12px", fontWeight: 600, color: "#374151", letterSpacing: "0.5px", textTransform: "uppercase" }}>
              Select {principalType}
            </div>
            <div style={{ maxHeight: "460px", overflowY: "auto" }}>
              {principalOptions.map((p) => {
                const active = principalId === p.id;
                const userMeta = principalType === "user" ? userById.get(p.id) : undefined;
                return (
                  <button key={p.id} onClick={() => setPrincipalId(p.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", background: active ? "color-mix(in srgb, var(--brand-primary) 3%, transparent)" : "transparent", border: "none", borderLeft: active ? "3px solid var(--brand-accent)" : "3px solid transparent", cursor: "pointer", textAlign: "left", borderBottom: "1px solid #f9fafb" }}>
                    <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: active ? "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))" : "linear-gradient(135deg, #e5e7eb, #d1d5db)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: active ? "var(--brand-accent)" : "#6b7280", flexShrink: 0 }}>
                      {p.avatar ?? p.label.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, color: "var(--brand-primary)", fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
                      <div style={{ color: "#9ca3af", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.sub}</div>
                    </div>
                    {userMeta && <PermissionsCountBadge user={userMeta} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Folder tree */}
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f4f5f7", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)" }}>
                  Permissions for <span style={{ color: "var(--brand-accent)" }}>{principalName}</span>
                </span>
                <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#9ca3af" }}>Changes are saved instantly.</p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                {principalType === "user" && principalId && userById.has(principalId) && (
                  <button
                    onClick={() => setViewAccessFor(principalId)}
                    title="See every folder and tab grant that effectively applies to this user"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "10px", border: "1.5px solid color-mix(in srgb, var(--brand-accent) 30%, transparent)", background: "color-mix(in srgb, var(--brand-accent) 8%, transparent)", color: "var(--brand-primary)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
                  >
                    <ScanEye size={13} color="var(--brand-accent)" />
                    View effective access
                  </button>
                )}
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  {PERM_LEVELS.map((perm) => (
                    <div key={perm} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: PERM_COLORS[perm] }} />
                      <span style={{ fontSize: "10px", color: "#6b7280" }}>{PERM_LABELS[perm]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", gap: "7px", borderBottom: "1px solid #f9fafb", background: "#fafbfc" }}>
              <Info size={13} color="#9ca3af" />
              <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                Folders inherit the nearest parent's permission unless you set one explicitly here.
              </span>
            </div>

            <div style={{ padding: "16px" }}>
              {tree.length === 0 ? (
                <div style={{ color: "#9ca3af", fontSize: "13px", padding: "20px", textAlign: "center" }}>
                  No folders yet. Connect Google Drive and create folders to manage access.
                </div>
              ) : (
                tree.map((node) => (
                  <FolderRow key={node.id} node={node} depth={0} levelFor={levelFor} sourceFor={sourceFor} onChange={handleChange} expanded={expanded} onToggle={toggleExpand} pending={pending} canAct={canActFolderAccess} />
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Effective-access modal — read-only summary of every grant that
          applies to the user picked in the left rail. Portaled so it isn't
          trapped by the grid's overflow rules. */}
      {viewAccessUser && typeof document !== "undefined" && createPortal(
        <div
          onClick={() => setViewAccessFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300, backdropFilter: "blur(4px)" }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: "white", borderRadius: "20px", padding: "32px", width: "720px", maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.25)", position: "relative", fontFamily: "'Poppins', sans-serif" }}
          >
            <button
              onClick={() => setViewAccessFor(null)}
              aria-label="Close"
              style={{ position: "absolute", top: "16px", right: "16px", background: "#f4f5f7", border: "none", borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <X size={15} color="#6b7280" />
            </button>
            <h3 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "18px", fontWeight: 700 }}>
              Effective access for {viewAccessUser.name}
            </h3>
            <p style={{ margin: "0 0 22px", color: "#9ca3af", fontSize: "13px" }}>
              Direct user grants and everything inherited via role + department.
            </p>
            <UserEffectiveAccess userId={viewAccessUser.id} preloaded={viewAccessUser} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// Inline summary chip rendered next to each user in the left rail. Shows the
// total folder + tab grant count, with a small badge when any are *direct*
// (per-user) so the super admin can scan for unusual setups at a glance.
// Super admins are filtered out of the principal list upstream, but we still
// guard in case that filter ever changes.
function PermissionsCountBadge({ user }: { user: UserWithPermissions }) {
  if (user.role === "super_admin") {
    return (
      <span
        title="Super Admin — full control everywhere by definition"
        style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "999px", background: "color-mix(in srgb, var(--brand-primary) 10%, transparent)", color: "var(--brand-primary)", border: "1px solid color-mix(in srgb, var(--brand-primary) 25%, transparent)", fontSize: "10px", fontWeight: 600, flexShrink: 0 }}
      >
        <ShieldCheck size={10} /> Full
      </span>
    );
  }
  const f = user.permissions.folders;
  const t = user.permissions.tabs;
  const folderCount = f.direct.length + f.inheritedRoleDept.length + f.inheritedRoleUnscoped.length;
  const tabCount = t.direct.length + t.inheritedRoleDept.length + t.inheritedRoleUnscoped.length;
  const directCount = f.direct.length + t.direct.length;
  const empty = folderCount === 0 && tabCount === 0;
  return (
    <span
      title={empty
        ? "No grants yet"
        : `${folderCount} folder grant${folderCount === 1 ? "" : "s"}, ${tabCount} tab grant${tabCount === 1 ? "" : "s"}${directCount > 0 ? ` (${directCount} direct)` : ""}`}
      style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "3px 8px", borderRadius: "999px", background: empty ? "#f4f5f7" : "#eef2ff", color: empty ? "#9ca3af" : "#3730a3", border: empty ? "1px solid #e5e7eb" : "1px solid #c7d2fe", fontSize: "10px", fontWeight: 600, flexShrink: 0 }}
    >
      <Folder size={10} />
      {folderCount}
      <span style={{ color: empty ? "#cbd5e1" : "#a5b4fc" }}>·</span>
      <ScanEye size={10} />
      {tabCount}
      {directCount > 0 && (
        <span style={{ marginLeft: "2px", padding: "0 4px", borderRadius: "999px", background: "#fef3c7", color: "#92400e", fontSize: "9px" }}>
          {directCount}D
        </span>
      )}
    </span>
  );
}
