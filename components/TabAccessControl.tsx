"use client";

// TabAccessControl — Super-Admin-only screen for managing TAB permissions.
// Mirrors the layout of FolderAccessControl but the right pane is a flat
// list of the 6 application tabs (no folder tree), and there are only 3
// levels: No Access / View / View + Action.
//
// Engine reminder (see .claude/rules/permissions.md "Tab Permission System"):
//   user grant > role+dept grant > unscoped role grant > 'no_access' default
// Super_admin short-circuits to 'action' on every tab, which is why we don't
// list them as a grantable principal here.

import { useMemo, useState } from "react";
import { User as UserIcon, Briefcase, Building2, Info } from "lucide-react";
import { toast } from "sonner";
import type { Role } from "@/lib/types";
import { TAB_NAMES, TAB_LABELS, TAB_LEVELS, TAB_LEVEL_LABELS, type TabName, type TabLevel } from "@/lib/tabs";
import { useTabGrants, useSetTabGrant, type TabGrant } from "@/lib/queries/tab-permissions";
import { useUsers, useDepartments } from "@/lib/queries/users";
import { Skeleton } from "@/components/Loader";

const SCOPE_ALL = "__all__";

// Same rationale as FolderAccessControl: super_admin always gets 'action'
// via the engine short-circuit, so granting them anything would be a no-op.
const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "team_lead", label: "Team Lead" },
  { value: "lead_dev", label: "Lead Dev" },
  { value: "team_member", label: "Team Member" },
];

const LEVEL_COLORS: Record<TabLevel, string> = {
  no_access: "#9ca3af",
  view: "#3b82f6",
  action: "#10b981",
};

// Inheritance badge used only on the Users tab — shows whether the displayed
// level is a per-user grant (no badge), a role+dept inherited grant, or an
// unscoped-role inherited grant. Same visual language as Folder Access Control
// so admins recognise it at a glance.
const SOURCE_BADGE: Record<"direct" | "role_dept" | "role_unscoped" | "none", { label: string; bg: string; fg: string } | null> = {
  direct: null,
  role_dept: { label: "inherited · role+dept", bg: "#dbeafe", fg: "#1e3a8a" },
  role_unscoped: { label: "inherited · role", bg: "#e0e7ff", fg: "#3730a3" },
  none: null,
};

export function TabAccessControl() {
  const grantsQuery = useTabGrants(true);
  const usersQuery = useUsers();
  const deptsQuery = useDepartments();
  const setGrant = useSetTabGrant();

  const grants = grantsQuery.data ?? [];
  const allUsers = usersQuery.data ?? [];
  const departments = deptsQuery.data ?? [];
  // Super Admins are not grantable principals — the engine short-circuits
  // them to 'action' on every tab. Granting them anything is a no-op.
  // Filter at the source so EVERY codepath (picker, default selection,
  // header label) sees the same set.
  const users = allUsers.filter((u) => u.role !== "super_admin");

  // ── Principal picker state ──
  const [principalType, setPrincipalType] = useState<"user" | "role">("role");
  const [principalId, setPrincipalId] = useState<string>(ROLES[0].value);
  const [principalDeptId, setPrincipalDeptId] = useState<string | null>(null);

  // Track in-flight changes per tab so we can spin only the row being edited.
  const [pending, setPending] = useState<Set<TabName>>(new Set());

  // ── Resolve the effective level for each tab, scoped to the selected principal ──
  //
  // Mirrors the Folder Access Control Users-tab fix and the SQL
  // get_effective_tab_level() semantics:
  //
  //   - Role view: explicit role grant for the chosen department scope only.
  //     Roles don't inherit from anywhere — admins set them per-tab.
  //
  //   - User view: user-wins. At each fallback step we return the first match:
  //       1. Per-user grant on this tab (including 'no_access' as explicit revocation)
  //       2. Role + caller's department grant
  //       3. Role-unscoped grant
  //       4. Otherwise 'no_access'
  //     Without this walk, every user appeared to have 'no_access' on every
  //     tab until a per-user grant was added — even when their role already
  //     gave them View / Action via the Roles tab.
  type TabLevelSource = "direct" | "role_dept" | "role_unscoped" | "none";
  type TabLevelResolution = { level: TabLevel; source: TabLevelSource };

  const resolveLevel = useMemo(() => {
    return (tab: TabName): TabLevelResolution => {
      if (principalType === "role") {
        const match = grants.find((g: TabGrant) =>
          g.tab === tab &&
          g.principalType === "role" &&
          g.principalId === principalId &&
          (g.principalDeptId ?? null) === principalDeptId,
        );
        return match ? { level: match.level, source: "direct" } : { level: "no_access", source: "none" };
      }

      // User view — user-wins, then role + dept, then role-unscoped.
      const targetUser = users.find((u) => u.id === principalId);
      if (!targetUser) return { level: "no_access", source: "none" };

      const userGrant = grants.find((g: TabGrant) =>
        g.tab === tab && g.principalType === "user" && g.principalId === targetUser.id,
      );
      if (userGrant) return { level: userGrant.level, source: "direct" };

      if (targetUser.departmentId) {
        const rdGrant = grants.find((g: TabGrant) =>
          g.tab === tab &&
          g.principalType === "role" &&
          g.principalId === targetUser.role &&
          (g.principalDeptId ?? null) === targetUser.departmentId,
        );
        if (rdGrant) return { level: rdGrant.level, source: "role_dept" };
      }

      const ruGrant = grants.find((g: TabGrant) =>
        g.tab === tab &&
        g.principalType === "role" &&
        g.principalId === targetUser.role &&
        (g.principalDeptId ?? null) === null,
      );
      if (ruGrant) return { level: ruGrant.level, source: "role_unscoped" };

      return { level: "no_access", source: "none" };
    };
  }, [grants, principalType, principalId, principalDeptId, users]);

  const levelFor = (tab: TabName): TabLevel => resolveLevel(tab).level;
  const sourceFor = (tab: TabName): TabLevelSource => resolveLevel(tab).source;

  // ── Principal options for the left list ──
  // `users` is already filtered to exclude super_admins above, so this map
  // is just shape conversion.
  const principalOptions: { id: string; label: string; sub: string }[] =
    principalType === "user"
      ? users.map((u) => ({ id: u.id, label: u.name, sub: u.departmentName }))
      : ROLES.map((r) => ({ id: r.value, label: r.label, sub: "Role" }));

  // ── Header label decorator ("Team Lead · CRM" vs "Team Lead · All departments") ──
  const principalLabel = (() => {
    if (principalType === "user") {
      return users.find((u) => u.id === principalId)?.name ?? "—";
    }
    const roleLabel = ROLES.find((r) => r.value === principalId)?.label ?? "—";
    if (principalDeptId) {
      const deptName = departments.find((d) => d.id === principalDeptId)?.name ?? "—";
      return `${roleLabel} · ${deptName}`;
    }
    return `${roleLabel} · All departments`;
  })();

  async function handleChange(tab: TabName, nextLevel: TabLevel) {
    setPending((p) => new Set(p).add(tab));
    try {
      await setGrant.mutateAsync({
        tab,
        principalType,
        principalId,
        principalDeptId: principalType === "user" ? null : principalDeptId,
        level: nextLevel,
      });
      toast.success(`${TAB_LABELS[tab]} set to ${TAB_LEVEL_LABELS[nextLevel]}`);
    } catch (e) {
      toast.error((e as Error).message ?? "Failed to update tab access");
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(tab);
        return next;
      });
    }
  }

  const loading = grantsQuery.isLoading || usersQuery.isLoading || deptsQuery.isLoading;

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ marginBottom: "20px" }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700 }}>
          Tab Access Control
        </h2>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px" }}>
          Decide which app screens each user or role can use. Independent of folder permissions.
        </p>
      </div>

      {/* Principal-type tabs */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        {([
          { t: "user" as const, label: "Users", icon: UserIcon },
          { t: "role" as const, label: "Roles", icon: Briefcase },
        ]).map(({ t, label, icon: Icon }) => {
          const active = principalType === t;
          return (
            <button key={t} onClick={() => {
              setPrincipalType(t);
              const first = t === "user" ? users[0]?.id : ROLES[0].value;
              setPrincipalId(first ?? "");
              setPrincipalDeptId(null);
            }}
              style={{ display: "flex", alignItems: "center", gap: "7px", padding: "8px 16px", borderRadius: "10px", border: `1.5px solid ${active ? "var(--brand-accent)" : "#e5e7eb"}`, background: active ? "color-mix(in srgb, var(--brand-accent) 7%, transparent)" : "white", color: active ? "var(--brand-primary)" : "#6b7280", fontSize: "13px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
              <Icon size={14} color={active ? "var(--brand-accent)" : "#9ca3af"} /> {label}
            </button>
          );
        })}
      </div>

      {/* Scope picker — only when granting to a role */}
      {principalType === "role" && !loading && (
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", padding: "10px 14px", background: "color-mix(in srgb, var(--brand-accent) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-accent) 18%, transparent)", borderRadius: "12px" }}>
          <Building2 size={14} color="var(--brand-accent)" />
          <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)" }}>Scope:</span>
          <select
            value={principalDeptId ?? SCOPE_ALL}
            onChange={(e) => setPrincipalDeptId(e.target.value === SCOPE_ALL ? null : e.target.value)}
            style={{ padding: "6px 12px", borderRadius: "8px", border: "1.5px solid #e5e7eb", background: "white", fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", outline: "none", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
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
        <div
          role="status"
          aria-live="polite"
          aria-label="Loading tab grants"
          style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "18px" }}
        >
          {/* Left rail skeleton — mirrors the principal list */}
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden", height: "fit-content", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #f4f5f7" }}>
              <Skeleton width={110} height={11} rounded="md" />
            </div>
            <div>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", borderBottom: "1px solid #f9fafb" }}>
                  <Skeleton width={32} height={32} rounded="md" />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Skeleton width={`${55 + ((i * 7) % 25)}%`} height={11} rounded="md" />
                    <Skeleton width={`${30 + ((i * 5) % 20)}%`} height={9} rounded="md" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right pane skeleton — mirrors the tab matrix (6 rows) */}
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <Skeleton width={110} height={9} rounded="md" />
                <Skeleton width={180} height={14} rounded="md" />
              </div>
              <Skeleton width={260} height={26} rounded="md" />
            </div>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "10px", border: "1px solid #eef0f4", background: "#fafbfc", marginBottom: "8px" }}
              >
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                  <Skeleton width={`${35 + ((i * 9) % 25)}%`} height={12} rounded="md" />
                  <Skeleton width={`${20 + ((i * 6) % 15)}%`} height={9} rounded="md" />
                </div>
                <Skeleton width={140} height={28} rounded="md" />
              </div>
            ))}
          </div>
        </div>
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
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "12px 18px", background: active ? "color-mix(in srgb, var(--brand-primary) 3%, transparent)" : "transparent", border: "none", borderLeft: active ? "3px solid var(--brand-accent)" : "3px solid transparent", cursor: "pointer", textAlign: "left", borderBottom: "1px solid #f9fafb", fontFamily: "'Poppins', sans-serif" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: "color-mix(in srgb, var(--brand-accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {principalType === "user" ? <UserIcon size={15} color="var(--brand-accent)" /> : <Briefcase size={15} color="var(--brand-accent)" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.label}</div>
                      <div style={{ fontSize: "11px", color: "#9ca3af" }}>{p.sub}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tab matrix */}
          <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", padding: "20px 24px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase" }}>Editing access for</div>
                <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--brand-primary)" }}>{principalLabel}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 10px", background: "#f4f5f7", borderRadius: "8px", fontSize: "11px", color: "#6b7280" }}>
                <Info size={12} /> Super admins already have View + Action everywhere.
              </div>
            </div>

            {TAB_NAMES.map((tab) => {
              const level = levelFor(tab);
              const source = sourceFor(tab);
              const badge = SOURCE_BADGE[source];
              const isPending = pending.has(tab);
              return (
                <div key={tab} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "10px", border: `1px solid ${level !== "no_access" ? LEVEL_COLORS[level] + "30" : "#eef0f4"}`, background: level !== "no_access" ? `${LEVEL_COLORS[level]}08` : "#fafbfc", marginBottom: "8px" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)" }}>{TAB_LABELS[tab]}</div>
                    <div style={{ fontSize: "11px", color: "#9ca3af" }}>/{tab.replace(/_/g, "-")}</div>
                  </div>
                  {badge && (
                    <span
                      title="This level is inherited from a role grant. Picking a new value here creates a per-user grant on this tab that overrides the inherited one."
                      style={{ padding: "2px 7px", borderRadius: "999px", background: badge.bg, color: badge.fg, fontSize: "9.5px", fontWeight: 600, letterSpacing: "0.3px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif" }}
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
                      value={level}
                      onChange={(e) => handleChange(tab, e.target.value as TabLevel)}
                      disabled={isPending}
                      aria-busy={isPending}
                      style={{ padding: "6px 12px", borderRadius: "8px", border: `1.5px solid ${LEVEL_COLORS[level]}40`, background: `${LEVEL_COLORS[level]}10`, color: LEVEL_COLORS[level], fontSize: "12px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", outline: "none", cursor: isPending ? "wait" : "pointer", minWidth: "140px", display: "block" }}
                    >
                      {TAB_LEVELS.map((lvl) => (
                        <option key={lvl} value={lvl}>{TAB_LEVEL_LABELS[lvl]}</option>
                      ))}
                    </select>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
