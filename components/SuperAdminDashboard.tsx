"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Users,
  HardDrive,
  Upload,
  Activity,
  UserPlus,
  FolderPlus,
  ScrollText,
  Shield,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import type { Screen, User } from "@/lib/types";
import { useUsers } from "@/lib/queries/users";
import { useAuditLogs, type AuditLogEntry } from "@/lib/queries/audit";
import { Skeleton } from "@/components/Loader";

// Maps audit action codes → short verb + UI bucket used by Recent Activity
// (the bucket drives the dot/avatar colour via actionTypeColors below).
const ACTION_LABELS: Record<string, { verb: string; type: string }> = {
  "file.upload": { verb: "Uploaded", type: "upload" },
  "file.download": { verb: "Downloaded", type: "download" },
  "folder.create": { verb: "Created folder", type: "folder" },
  "perm.grant": { verb: "Changed permissions", type: "permission" },
  "assignee.add": { verb: "Added assignee", type: "permission" },
  "assignee.remove": { verb: "Removed assignee", type: "permission" },
  "admin.user_create": { verb: "Created user", type: "admin" },
  "admin.branding_update": { verb: "Updated branding", type: "admin" },
  "admin.branding_logo_upload": { verb: "Updated logo", type: "admin" },
  "drive.connect": { verb: "Connected Drive", type: "admin" },
  "drive.verify": { verb: "Verified Drive", type: "admin" },
  "self.profile_update": { verb: "Updated profile", type: "view" },
  "self.password_change": { verb: "Changed password", type: "view" },
};

function describeAction(log: AuditLogEntry): { verb: string; type: string; target: string } {
  const label = ACTION_LABELS[log.action] ?? { verb: log.action.replace(/[._]/g, " "), type: "view" };
  const d = (log.details ?? {}) as Record<string, unknown>;
  const target =
    (typeof d.name === "string" && d.name) ||
    (typeof d.fileName === "string" && d.fileName) ||
    (typeof d.folderName === "string" && d.folderName) ||
    (typeof d.email === "string" && d.email) ||
    log.resourceType ||
    "";
  return { verb: label.verb, type: label.type, target: String(target) };
}

function relativeTime(iso: string, now: number): string {
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Math.floor((now - t) / 1000));
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  user: User;
  setScreen: (s: Screen) => void;
}

const uploadData = [
  { day: "Mon", files: 14 },
  { day: "Tue", files: 22 },
  { day: "Wed", files: 18 },
  { day: "Thu", files: 31 },
  { day: "Fri", files: 27 },
  { day: "Sat", files: 8 },
  { day: "Sun", files: 5 },
];

const storageData = [
  { name: "HR & Admin", value: 120, color: "var(--brand-accent)" },
  { name: "Projects", value: 200, color: "var(--brand-primary)" },
  { name: "Company Assets", value: 80, color: "#3b82f6" },
  { name: "WordPress", value: 30, color: "#22c55e" },
  { name: "Legal", value: 20, color: "#f59e0b" },
];

const actionTypeColors: Record<string, string> = {
  download: "#3b82f6",
  upload: "#22c55e",
  folder: "var(--brand-accent)",
  permission: "#8b5cf6",
  admin: "#e11d48",
  view: "#6b7280",
};

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
  trend,
  loading,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub: string;
  color: string;
  trend?: string;
  /** When true, the value + sub lines render as shimmer skeletons instead of text. */
  loading?: boolean;
}) {
  return (
    <div
      style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)", position: "relative", overflow: "hidden", transition: "transform 0.2s, box-shadow 0.2s", cursor: "default" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(0,0,0,0.1)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.03)"; }}>
      <div style={{ position: "absolute", top: "-20px", right: "-20px", width: "80px", height: "80px", borderRadius: "50%", background: color, opacity: 0.06 }} />
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ width: "42px", height: "42px", borderRadius: "12px", background: `${color}15`, border: `1px solid ${color}25`, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={19} color={color} />
        </div>
        {trend && !loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "3px", fontSize: "11px", color: "#22c55e", fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>
            <TrendingUp size={11} />{trend}
          </div>
        )}
      </div>
      {loading ? (
        <div style={{ marginBottom: "6px" }}>
          <Skeleton width={90} height={26} rounded="md" />
        </div>
      ) : (
        <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", lineHeight: 1.1, marginBottom: "4px" }}>{value}</div>
      )}
      <div style={{ fontSize: "12px", fontWeight: 600, color: "#374151", fontFamily: "'Poppins', sans-serif", marginBottom: "2px" }}>{label}</div>
      {loading ? (
        <Skeleton width={170} height={11} rounded="md" />
      ) : (
        <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{sub}</div>
      )}
    </div>
  );
}

export function SuperAdminDashboard({ user, setScreen }: Props) {
  // Render the current date only after mount so SSR (server time) and the
  // first client render produce identical HTML — no hydration mismatch.
  const [todayLabel, setTodayLabel] = useState<string>("");
  // Mount flag also gates relative-time rendering (Date.now() in render would
  // hydrate-mismatch on first paint).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setTodayLabel(
      new Date().toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    );
    setNowMs(Date.now());
    // Tick once a minute so "X min ago" stays fresh while the tab is open.
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // ── Live data ───────────────────────────────────────────────────────────
  const usersQ = useUsers();
  const logsQ = useAuditLogs(500);

  const userStats = useMemo(() => {
    const list = usersQ.data ?? [];
    const byRole: Record<string, number> = {};
    for (const u of list) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
    return {
      total: list.length,
      superAdmin: byRole.super_admin ?? 0,
      admin: byRole.admin ?? 0,
      staff:
        (byRole.manager ?? 0) +
        (byRole.team_lead ?? 0) +
        (byRole.lead_dev ?? 0) +
        (byRole.team_member ?? 0),
    };
  }, [usersQ.data]);

  // "Files Uploaded Today" + "Active Right Now" both derive from audit logs.
  // nowMs is null until after mount → we hide the numbers ("—") until then,
  // which keeps SSR/CSR HTML identical (no hydration mismatch) and avoids
  // showing zeros while the data is still loading.
  const fileUploadsToday = useMemo(() => {
    if (!nowMs || !logsQ.data) return null;
    const startOfDay = new Date(nowMs);
    startOfDay.setHours(0, 0, 0, 0);
    const cutoff = startOfDay.getTime();
    return logsQ.data.filter(
      (l) => l.action === "file.upload" && new Date(l.timestamp).getTime() >= cutoff,
    ).length;
  }, [logsQ.data, nowMs]);

  const activeRightNow = useMemo(() => {
    if (!nowMs || !logsQ.data) return null;
    const cutoff = nowMs - 15 * 60 * 1000;
    const actors = new Set<string>();
    for (const l of logsQ.data) {
      if (!l.actorId) continue;
      if (new Date(l.timestamp).getTime() >= cutoff) actors.add(l.actorId);
    }
    return actors.size;
  }, [logsQ.data, nowMs]);

  // Top 5 recent audit entries for the Recent Activity panel.
  const recentEvents = useMemo(() => (logsQ.data ?? []).slice(0, 5), [logsQ.data]);

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif", minHeight: "100%" }}>
      {/* Header */}
      <div style={{ marginBottom: "28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div>
            <h1 style={{ color: "var(--brand-primary)", margin: "0 0 4px", fontSize: "22px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
              Welcome back, {user.name.split(" ")[0]} 👋
            </h1>
            <p style={{ color: "#9ca3af", margin: 0, fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
              Here&apos;s what&apos;s happening in your vault today{todayLabel ? ` — ${todayLabel}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px", marginBottom: "24px" }}>
        <StatCard
          icon={Users}
          label="Total Users"
          value={String(userStats.total)}
          sub={`${userStats.superAdmin} Super Admin · ${userStats.admin} Admin · ${userStats.staff} Staff`}
          color="var(--brand-primary)"
          loading={usersQ.isLoading}
        />
        {/* Storage Used: no aggregate endpoint yet — sample data, will wire when
            the dashboard stats endpoint lands. */}
        <StatCard icon={HardDrive} label="Storage Used"           value="450 GB" sub="of 2TB · 22% used (sample)"             color="var(--brand-accent)" />
        <StatCard
          icon={Upload}
          label="Files Uploaded Today"
          value={fileUploadsToday === null ? "0" : String(fileUploadsToday)}
          sub={
            fileUploadsToday === 0
              ? "No uploads yet today"
              : "Across all departments"
          }
          color="#22c55e"
          loading={fileUploadsToday === null}
        />
        <StatCard
          icon={Activity}
          label="Active Right Now"
          value={activeRightNow === null ? "0" : String(activeRightNow)}
          sub={
            activeRightNow === 0
              ? "no activity in last 15 min"
              : `users active in last 15 min`
          }
          color="#8b5cf6"
          loading={activeRightNow === null}
        />
      </div>

      {/* Main grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 320px", gap: "18px", marginBottom: "18px" }}>
        {/* Upload activity chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h3 style={{ margin: "0 0 2px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Upload Activity</h3>
              <p style={{ margin: 0, color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>Files uploaded this week</p>
            </div>
            <div style={{ background: "#f0f9f4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "4px 10px", fontSize: "11px", fontWeight: 600, color: "#16a34a", fontFamily: "'Poppins', sans-serif" }}>+22% vs last week</div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={uploadData}>
              <defs>
                <linearGradient id="uploadGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--brand-accent)" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="var(--brand-accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f5f7" />
              <XAxis dataKey="day" tick={{ fontSize: 11, fontFamily: "'Poppins', sans-serif", fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fontFamily: "'Poppins', sans-serif", fill: "#9ca3af" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: "var(--brand-primary)", border: "none", borderRadius: "10px", color: "white", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }} cursor={{ stroke: "var(--brand-accent)", strokeWidth: 1 }} />
              <Area type="monotone" dataKey="files" stroke="var(--brand-accent)" strokeWidth={2.5} fill="url(#uploadGrad)" dot={{ fill: "var(--brand-accent)", r: 3 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Storage pie chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ marginBottom: "16px" }}>
            <h3 style={{ margin: "0 0 2px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Storage by Department</h3>
            <p style={{ margin: 0, color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>450 GB of 2 TB used</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <PieChart width={130} height={130}>
              <Pie data={storageData} cx={60} cy={60} innerRadius={38} outerRadius={60} dataKey="value" strokeWidth={0}>
                {storageData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
              </Pie>
            </PieChart>
            <div style={{ flex: 1 }}>
              {storageData.map((d) => (
                <div key={d.name} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <div style={{ width: "8px", height: "8px", borderRadius: "2px", background: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: "11px", color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{d.name}</span>
                  </div>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{d.value}GB</span>
                </div>
              ))}
            </div>
          </div>

          {/* Storage bar */}
          <div style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>Google Workspace 2TB</span>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>22.5%</span>
            </div>
            <div style={{ height: "8px", background: "#f4f5f7", borderRadius: "100px", overflow: "hidden" }}>
              <div style={{ height: "100%", width: "22.5%", background: "linear-gradient(90deg, var(--brand-accent), #e8c96a)", borderRadius: "100px" }} />
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div style={{ background: "linear-gradient(135deg, var(--brand-primary), #0f1e38)", borderRadius: "16px", padding: "22px 20px", border: "1px solid rgba(201,168,76,0.2)", boxShadow: "0 4px 20px rgba(27,42,74,0.25)", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", bottom: "-20px", right: "-20px", width: "120px", height: "120px", borderRadius: "50%", background: "rgba(201,168,76,0.05)", pointerEvents: "none" }} />
          <h3 style={{ color: "white", margin: "0 0 4px", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Quick Actions</h3>
          <p style={{ color: "rgba(255,255,255,0.4)", margin: "0 0 18px", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>Common administrative tasks</p>

          {[
            { icon: UserPlus,   label: "Create New User",   action: () => setScreen("users"),   color: "var(--brand-accent)" },
            { icon: FolderPlus, label: "Create New Folder", action: () => setScreen("files"),   color: "#3b82f6" },
            { icon: ScrollText, label: "View Audit Logs",   action: () => setScreen("audit"),   color: "#22c55e" },
            { icon: Shield,     label: "Manage Roles",      action: () => setScreen("folders"), color: "#8b5cf6" },
          ].map((item, i) => (
            <button key={i} onClick={item.action}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.04)", cursor: "pointer", marginBottom: "8px", transition: "all 0.15s", textAlign: "left" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.1)"; (e.currentTarget as HTMLButtonElement).style.borderColor = `${item.color}40`; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255,255,255,0.06)"; }}>
              <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: `${item.color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <item.icon size={14} color={item.color} />
              </div>
              <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "12px", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{ background: "white", borderRadius: "16px", padding: "22px 24px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "18px" }}>
          <div>
            <h3 style={{ margin: "0 0 2px", color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Recent Activity</h3>
            <p style={{ margin: 0, color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>Latest file operations across the vault</p>
          </div>
          <button onClick={() => setScreen("audit")}
            style={{ padding: "6px 14px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "8px", fontSize: "12px", color: "var(--brand-primary)", cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>
            View All Logs
          </button>
        </div>

        <div>
          {logsQ.isLoading && (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={`sk-${i}`} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: i < 4 ? "1px solid #f9fafb" : "none" }}>
                  <Skeleton width={34} height={34} rounded="lg" />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                    <Skeleton width="55%" height={12} rounded="md" />
                    <Skeleton width="35%" height={10} rounded="md" />
                  </div>
                  <Skeleton width={56} height={10} rounded="md" />
                </div>
              ))}
            </>
          )}
          {!logsQ.isLoading && recentEvents.length === 0 && (
            <div style={{ padding: "12px 0", color: "#9ca3af", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }}>
              No activity recorded yet.
            </div>
          )}
          {!logsQ.isLoading && recentEvents.map((log, i) => {
            const { verb, type, target } = describeAction(log);
            const color = actionTypeColors[type] ?? actionTypeColors.view;
            const initials = log.actorName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
            return (
              <div key={log.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderBottom: i < recentEvents.length - 1 ? "1px solid #f9fafb" : "none" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: `${color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "11px", fontWeight: 700, color, fontFamily: "'Poppins', sans-serif" }}>
                  {initials || "??"}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, color: "var(--brand-primary)", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>{log.actorName}</span>
                    <span style={{ color: "#6b7280", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }}>{verb}</span>
                    {target && (
                      <span style={{ color: "var(--brand-primary)", fontSize: "12px", fontFamily: "'Poppins', sans-serif", background: "#f4f5f7", padding: "1px 8px", borderRadius: "6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "260px" }}>{target}</span>
                    )}
                    {log.result === "failure" && (
                      <span style={{ color: "#dc2626", fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>failed</span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif", flexShrink: 0 }}>
                  <Clock size={11} />{nowMs === null ? "—" : relativeTime(log.timestamp, nowMs)}
                </div>
                <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, flexShrink: 0 }} />
              </div>
            );
          })}
        </div>
      </div>

      {/* System status row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", marginTop: "18px" }}>
        {[
          { icon: CheckCircle, label: "Google Drive API",       status: "Connected",       color: "#22c55e", bg: "#f0fdf4" },
          { icon: AlertCircle, label: "Failed Logins (24h)",    status: "3 Attempts",      color: "#f59e0b", bg: "#fffbeb" },
          { icon: Shield,      label: "2FA Status",             status: "18 / 48 Users",   color: "#8b5cf6", bg: "#faf5ff" },
        ].map((item, i) => (
          <div key={i} style={{ background: item.bg, borderRadius: "12px", padding: "14px 18px", display: "flex", alignItems: "center", gap: "12px", border: `1px solid ${item.color}25` }}>
            <item.icon size={18} color={item.color} />
            <div>
              <div style={{ fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>{item.label}</div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: item.color, fontFamily: "'Poppins', sans-serif" }}>{item.status}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
