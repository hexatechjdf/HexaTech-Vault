"use client";

// UserEffectiveAccess — shows every grant that effectively applies to a
// single user, split into clearly-labelled buckets:
//
//   Folder permissions
//     1. Direct user grants     (badge: green)
//     2. Inherited via Role + Department  (badge: blue)
//     3. Inherited via Role (all departments) (badge: gray)
//
//   Tab permissions  - same buckets, same colours.
//
// The split lets a Super Admin understand at a glance WHY a user has access
// to something. "She can see the CRM/Proposal folder because team_member@CRM
// has full_control there, not because anyone gave her a direct grant" is the
// kind of question this view answers.

import {
  useEffectiveAccess,
  type FolderAccessRow,
  type TabAccessRow,
  type UserWithPermissions,
} from "@/lib/queries/users";
import { TAB_LABELS, type TabName } from "@/lib/tabs";
import { Folder, Layers, User as UserIcon, Briefcase, Building2 } from "lucide-react";

const SOURCE_COLORS = {
  direct: "#10b981",
  role_dept: "#3b82f6",
  role_unscoped: "#6b7280",
};

const SOURCE_ICONS = {
  direct: UserIcon,
  role_dept: Building2,
  role_unscoped: Briefcase,
};

const SOURCE_LABELS = {
  direct: "Direct user grant",
  role_dept: "Inherited via Role + Department",
  role_unscoped: "Inherited via Role (all departments)",
};

const PANEL_BG = "white";
const PANEL_BORDER = "1px solid #eef0f4";
const PANEL_SHADOW = "0 1px 4px rgba(0,0,0,0.04)";

interface Props {
  userId: string | null | undefined;
  /**
   * Pre-fetched user + grants. When supplied, the component renders
   * immediately without hitting /api/admin/users/[id]/effective-access. This
   * is how the User Management table now opens the View Access modal — the
   * data is already in the users query.
   */
  preloaded?: UserWithPermissions | null;
}

export function UserEffectiveAccess({ userId, preloaded }: Props) {
  // If the caller already has the data (table rows do), skip the fetch
  // entirely. The hook is only enabled when there's no preloaded payload.
  const q = useEffectiveAccess(userId, !!userId && !preloaded);

  if (!userId && !preloaded) {
    return (
      <div style={{ padding: "24px", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
        Select a user to view their effective access.
      </div>
    );
  }

  // Pre-shape preloaded UserWithPermissions into the same EffectiveAccessResult
  // shape the fetch returns, so the render path below is identical.
  const data = preloaded
    ? {
        user: {
          id: preloaded.id,
          name: preloaded.name,
          email: preloaded.email,
          role: preloaded.role,
          departmentId: preloaded.departmentId || null,
          departmentName: preloaded.departmentName || null,
        },
        folders: preloaded.permissions.folders,
        tabs: preloaded.permissions.tabs,
      }
    : q.data;

  if (!preloaded && q.isLoading) {
    return (
      <div style={{ padding: "24px", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
        Loading effective access…
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: "24px", color: "#ef4444", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
        {(q.error as Error)?.message ?? "Failed to load effective access"}
      </div>
    );
  }

  const { user, folders, tabs } = data;

  return (
    <div style={{ padding: "20px 24px", fontFamily: "'Poppins', sans-serif", display: "flex", flexDirection: "column", gap: "20px" }}>
      <Header
        name={user.name}
        email={user.email}
        role={user.role}
        deptName={user.departmentName}
      />

      <Section title="Folder permissions" icon={<Folder size={14} color="var(--brand-accent)" />}>
        <Bucket
          source="direct"
          rows={folders.direct}
          empty="No direct folder grants."
          renderRow={(row) => (
            <FolderRow key={row.id} row={row as FolderAccessRow} />
          )}
        />
        <Bucket
          source="role_dept"
          rows={folders.inheritedRoleDept}
          empty="No role-and-department-scoped folder grants."
          renderRow={(row) => <FolderRow key={row.id} row={row as FolderAccessRow} />}
        />
        <Bucket
          source="role_unscoped"
          rows={folders.inheritedRoleUnscoped}
          empty="No unscoped role folder grants."
          renderRow={(row) => <FolderRow key={row.id} row={row as FolderAccessRow} />}
        />
      </Section>

      <Section title="Tab permissions" icon={<Layers size={14} color="var(--brand-accent)" />}>
        <Bucket
          source="direct"
          rows={tabs.direct}
          empty="No direct tab grants."
          renderRow={(row) => <TabRow key={row.id} row={row as TabAccessRow} />}
        />
        <Bucket
          source="role_dept"
          rows={tabs.inheritedRoleDept}
          empty="No role-and-department-scoped tab grants."
          renderRow={(row) => <TabRow key={row.id} row={row as TabAccessRow} />}
        />
        <Bucket
          source="role_unscoped"
          rows={tabs.inheritedRoleUnscoped}
          empty="No unscoped role tab grants."
          renderRow={(row) => <TabRow key={row.id} row={row as TabAccessRow} />}
        />
      </Section>
    </div>
  );
}

function Header({ name, email, role, deptName }: { name: string; email: string; role: string; deptName: string | null }) {
  return (
    <div style={{ background: PANEL_BG, border: PANEL_BORDER, borderRadius: "16px", boxShadow: PANEL_SHADOW, padding: "16px 20px", display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: "color-mix(in srgb, var(--brand-accent) 12%, transparent)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <UserIcon size={18} color="var(--brand-accent)" />
      </div>
      <div>
        <div style={{ fontSize: "15px", fontWeight: 700, color: "var(--brand-primary)" }}>{name}</div>
        <div style={{ fontSize: "12px", color: "#6b7280" }}>{email}</div>
        <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "2px" }}>
          {role}{deptName ? ` · ${deptName}` : ""}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: PANEL_BG, border: PANEL_BORDER, borderRadius: "16px", boxShadow: PANEL_SHADOW, padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
        {icon}
        <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--brand-primary)" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function Bucket({
  source, rows, empty, renderRow,
}: {
  source: "direct" | "role_dept" | "role_unscoped";
  rows: (FolderAccessRow | TabAccessRow)[];
  empty: string;
  renderRow: (row: FolderAccessRow | TabAccessRow) => React.ReactNode;
}) {
  const Icon = SOURCE_ICONS[source];
  const color = SOURCE_COLORS[source];
  return (
    <div style={{ marginBottom: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "3px 8px", borderRadius: "999px", background: `${color}15`, color, fontSize: "11px", fontWeight: 600 }}>
          <Icon size={11} />
          {SOURCE_LABELS[source]}
        </span>
        <span style={{ fontSize: "11px", color: "#9ca3af" }}>({rows.length})</span>
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: "12px", color: "#9ca3af", paddingLeft: "10px" }}>{empty}</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {rows.map(renderRow)}
        </div>
      )}
    </div>
  );
}

function FolderRow({ row }: { row: FolderAccessRow }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "10px", border: "1px solid #f4f5f7", background: "#fafbfc" }}>
      <Folder size={13} color="#9ca3af" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.folderName}
        </div>
        <div style={{ fontSize: "10px", color: "#9ca3af", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {row.folderPath || row.via}
        </div>
      </div>
      <span style={{ fontSize: "10px", fontWeight: 600, padding: "3px 8px", borderRadius: "6px", background: "#eef0f4", color: "var(--brand-primary)" }}>
        {row.level}
      </span>
    </div>
  );
}

function TabRow({ row }: { row: TabAccessRow }) {
  const tabLabel = TAB_LABELS[row.tab as TabName] ?? row.tab;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 12px", borderRadius: "10px", border: "1px solid #f4f5f7", background: "#fafbfc" }}>
      <Layers size={13} color="#9ca3af" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)" }}>{tabLabel}</div>
        <div style={{ fontSize: "10px", color: "#9ca3af" }}>{row.via}</div>
      </div>
      <span style={{ fontSize: "10px", fontWeight: 600, padding: "3px 8px", borderRadius: "6px", background: "#eef0f4", color: "var(--brand-primary)" }}>
        {row.level}
      </span>
    </div>
  );
}
