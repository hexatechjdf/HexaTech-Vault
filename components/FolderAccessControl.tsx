"use client";

import { useEffect, useMemo, useState } from "react";
import { Folder, FolderOpen, ChevronRight, ChevronDown, User, Briefcase, Info, Building2 } from "lucide-react";
import { toast } from "sonner";
import { getBackend } from "@/lib/backend";
import type { AppUser, Department, FolderDTO, GrantDTO, PermLevel, PrincipalType, Role } from "@/lib/types";
import { PERM_LABELS, PERM_COLORS, PERM_LEVELS } from "@/lib/permissions";

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

/** Recursively load the root-scoped folder tree via the backend (super admin sees everything). */
async function loadTree(backend: ReturnType<typeof getBackend>): Promise<{ tree: FolderNode[]; ids: string[] }> {
  const ids: string[] = [];
  async function build(folders: FolderDTO[]): Promise<FolderNode[]> {
    const nodes: FolderNode[] = [];
    for (const f of folders) {
      ids.push(f.id);
      const res = await backend.list(f.id);
      nodes.push({ id: f.id, name: f.name, children: await build(res.folders) });
    }
    return nodes;
  }
  const root = await backend.list(null);
  const tree = await build(root.folders);
  return { tree, ids };
}

function FolderRow({
  node, depth, levelFor, onChange, expanded, onToggle, pending,
}: {
  node: FolderNode;
  depth: number;
  levelFor: (folderId: string) => PermLevel;
  onChange: (folderId: string, level: PermLevel) => void;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  pending: Set<string>;
}) {
  const perm = levelFor(node.id);
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
            onChange={(e) => onChange(node.id, e.target.value as PermLevel)}
            disabled={isPending}
            aria-busy={isPending}
            style={{ padding: "4px 10px", borderRadius: "8px", border: `1.5px solid ${PERM_COLORS[perm]}40`, background: `${PERM_COLORS[perm]}10`, color: PERM_COLORS[perm], fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", outline: "none", cursor: isPending ? "wait" : "pointer", display: "block" }}
          >
            {PERM_LEVELS.map((val) => (
              <option key={val} value={val}>{PERM_LABELS[val]}</option>
            ))}
          </select>
        </span>
      </div>
      {hasChildren && isExpanded && node.children.map((child) => (
        <FolderRow key={child.id} node={child} depth={depth + 1} levelFor={levelFor} onChange={onChange} expanded={expanded} onToggle={onToggle} pending={pending} />
      ))}
    </>
  );
}

export function FolderAccessControl() {
  const backend = useMemo(() => getBackend(), []);
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [, setFolderIds] = useState<string[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [grantsByFolder, setGrantsByFolder] = useState<Record<string, GrantDTO[]>>({});
  const [loading, setLoading] = useState(true);

  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  const [principalId, setPrincipalId] = useState<string>("");
  /** Department scope for role grants. `null` = "All departments" (unscoped, the
   *  default behaviour). A real dept id narrows the grant to users with the
   *  current role AND that department. Always null when principalType==='user'. */
  const [principalDeptId, setPrincipalDeptId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [{ tree, ids }, us, depts] = await Promise.all([
          loadTree(backend),
          backend.listUsers(),
          backend.listDepartments(),
        ]);
        setTree(tree);
        setFolderIds(ids);
        // Super admins are excluded from the grantable user list - they own
        // the Drive and have full_control everywhere by definition.
        setUsers(us.filter((u) => u.role !== "super_admin"));
        setDepartments(depts);
        setExpanded(new Set(tree.map((n) => n.id))); // expand top level
        const grantsMap: Record<string, GrantDTO[]> = {};
        await Promise.all(ids.map(async (id) => { grantsMap[id] = await backend.getGrants(id); }));
        setGrantsByFolder(grantsMap);
        if (us.length) setPrincipalId(us[0].id);
      } catch (e) {
        toast.error((e as Error).message || "Failed to load folder permissions.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Explicit grant level for the *currently selected principal* on a folder.
  // For user grants, principalDeptId is always null and ignored. For role
  // grants, we match the dept scope too so the "Team Member · CRM" view shows
  // only the CRM-scoped grants — never the unscoped "all departments" ones.
  const levelFor = (folderId: string): PermLevel => {
    const g = (grantsByFolder[folderId] ?? []).find((x) => {
      if (x.principalType !== principalType) return false;
      if (x.principalId !== principalId) return false;
      if (principalType === "role") {
        const want = principalDeptId; // null = unscoped slot
        const have = x.principalDeptId ?? null;
        return want === have;
      }
      return true;
    });
    return g?.level ?? "no_access";
  };

  const handleChange = async (folderId: string, level: PermLevel) => {
    if (!principalId) return;
    // No optimistic update — UI state only changes on success. If the server rejects
    // (e.g. 422 from permissions-set: "...isn't a Google account..."), the controlled
    // <select> snaps back to the previous level on its own because grantsByFolder
    // hasn't been touched. The API's `error` field is surfaced via the toast.
    setPending((prev) => {
      const next = new Set(prev);
      next.add(folderId);
      return next;
    });
    try {
      await backend.setGrant({
        folderId,
        principalType,
        principalId,
        // User grants force dept to null; role grants pass the selected scope
        // (null when "All departments" is picked).
        principalDeptId: principalType === "user" ? null : principalDeptId,
        level,
      });
      const fresh = await backend.getGrants(folderId);
      setGrantsByFolder((prev) => ({ ...prev, [folderId]: fresh }));
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
                return (
                  <button key={p.id} onClick={() => setPrincipalId(p.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", background: active ? "color-mix(in srgb, var(--brand-primary) 3%, transparent)" : "transparent", border: "none", borderLeft: active ? "3px solid var(--brand-accent)" : "3px solid transparent", cursor: "pointer", textAlign: "left", borderBottom: "1px solid #f9fafb" }}>
                    <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: active ? "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))" : "linear-gradient(135deg, #e5e7eb, #d1d5db)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: active ? "var(--brand-accent)" : "#6b7280", flexShrink: 0 }}>
                      {p.avatar ?? p.label.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: "var(--brand-primary)", fontSize: "13px" }}>{p.label}</div>
                      <div style={{ color: "#9ca3af", fontSize: "11px" }}>{p.sub}</div>
                    </div>
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
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                {PERM_LEVELS.map((perm) => (
                  <div key={perm} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: PERM_COLORS[perm] }} />
                    <span style={{ fontSize: "10px", color: "#6b7280" }}>{PERM_LABELS[perm]}</span>
                  </div>
                ))}
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
                  <FolderRow key={node.id} node={node} depth={0} levelFor={levelFor} onChange={handleChange} expanded={expanded} onToggle={toggleExpand} pending={pending} />
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
