"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FolderOpen, Upload, TrendingUp, CheckCircle, Clock,
  AlertCircle, Check, X, Eye, FileText, Users,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import type { Screen, User } from "@/lib/types";
import { useAuth } from "@/lib/auth";
import { useUsers } from "@/lib/queries/users";
import { useAuditLogs, type AuditLogEntry } from "@/lib/queries/audit";
import { Skeleton } from "@/components/Loader";

// Action-code → short verb. Admin's audit feed is RLS-scoped to their own
// department, so we never need to render admin.* / drive.* rows; map them
// anyway so the fallback path stays clean.
const ACTION_LABELS_ADMIN: Record<string, string> = {
  "file.upload": "uploaded",
  "file.download": "downloaded",
  "folder.create": "created folder",
  "perm.grant": "changed permissions on",
  "assignee.add": "added assignee to",
  "assignee.remove": "removed assignee from",
  "admin.user_create": "created user",
  "self.profile_update": "updated profile",
  "self.password_change": "changed password",
};

function shortVerb(action: string): string {
  return ACTION_LABELS_ADMIN[action] ?? action.replace(/[._]/g, " ");
}

function targetOf(log: AuditLogEntry): string {
  const d = (log.details ?? {}) as Record<string, unknown>;
  return ((typeof d.name === "string" && d.name) ||
    (typeof d.fileName === "string" && d.fileName) ||
    (typeof d.folderName === "string" && d.folderName) ||
    (typeof d.email === "string" && d.email) ||
    log.resourceType ||
    "") as string;
}

function adminRelTime(iso: string, now: number): string {
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

const weeklyUploads = [
  { day: "Mon", files: 5 },
  { day: "Tue", files: 12 },
  { day: "Wed", files: 8 },
  { day: "Thu", files: 15 },
  { day: "Fri", files: 10 },
  { day: "Sat", files: 2 },
  { day: "Sun", files: 0 },
];

interface PendingFile {
  id: number;
  name: string;
  uploadedBy: string;
  size: string;
  date: string;
  type: string;
  status: "pending" | "approved" | "rejected";
}

const initialPending: PendingFile[] = [
  { id: 1, name: "Q1_Payroll_2026.pdf",       uploadedBy: "Raza Malik",  size: "2.4 MB", date: "Today, 9:15 AM",   type: "PDF",  status: "pending" },
  { id: 2, name: "Recruitment_Report_May.docx", uploadedBy: "Hina Baig",  size: "1.1 MB", date: "Today, 11:00 AM",  type: "DOC",  status: "pending" },
  { id: 3, name: "Team_Meeting_Recording.mp4",  uploadedBy: "Ali Hassan", size: "48.2 MB", date: "Yesterday, 4:30 PM", type: "VIDEO", status: "pending" },
];

const storageItems = [
  { label: "HR & Admin",       used: 120, total: 200, color: "var(--brand-accent)" },
  { label: "Recruitment",      used: 45,  total: 100, color: "#3b82f6" },
  { label: "Policy Documents", used: 18,  total: 50,  color: "#22c55e" },
];

export function AdminDashboard({ user, setScreen }: Props) {
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>(initialPending);

  const pendingCount = pendingFiles.filter(f => f.status === "pending").length;

  // ── Live data ───────────────────────────────────────────────────────────
  // Identity: useAuth() gives us the live AppUser with departmentId, which we
  // need to count active teammates within this admin's department.
  const { user: me } = useAuth();
  const usersQ = useUsers();
  const logsQ = useAuditLogs(500);

  // Tick "now" once a minute so relative timestamps stay fresh. Starts null to
  // avoid hydration mismatch from rendering Date.now() during SSR/CSR.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Active Team Members: same-department, active app_users.
  const deptUserStats = useMemo(() => {
    const list = usersQ.data ?? [];
    if (!me?.departmentId) return { total: 0, active: 0 };
    const dept = list.filter((u) => u.departmentId === me.departmentId);
    return {
      total: dept.length,
      active: dept.filter((u) => u.status !== "inactive").length,
    };
  }, [usersQ.data, me?.departmentId]);

  // Files This Week: audit rows in this dept with action=file.upload and ≥7d-old.
  // RLS already scopes admins to own-department rows so no extra filter needed.
  const filesThisWeek = useMemo(() => {
    if (!nowMs || !logsQ.data) return null;
    const cutoff = nowMs - 7 * 24 * 60 * 60 * 1000;
    return logsQ.data.filter(
      (l) => l.action === "file.upload" && new Date(l.timestamp).getTime() >= cutoff,
    ).length;
  }, [logsQ.data, nowMs]);

  // Recent Team Activity panel: top 5 audit rows (already dept-scoped via RLS).
  const recentTeamEvents = useMemo(() => (logsQ.data ?? []).slice(0, 5), [logsQ.data]);

  const handleApprove = (id: number) => {
    setPendingFiles(prev => prev.map(f => f.id === id ? { ...f, status: "approved" } : f));
    toast.success("File approved and published");
  };

  const handleReject = (id: number) => {
    setPendingFiles(prev => prev.map(f => f.id === id ? { ...f, status: "rejected" } : f));
    toast.error("File rejected and removed from queue");
  };

  const statCards: {
    label: string;
    value: string;
    sub: string;
    icon: typeof FolderOpen;
    color: string;
    bg: string;
    /** When true, value + sub are rendered as shimmer skeletons. */
    loading?: boolean;
  }[] = [
    // No dept storage aggregate endpoint yet — sample.
    { label: "Dept Storage Used", value: "183 GB", sub: "of 500 GB (sample)", icon: FolderOpen, color: "var(--brand-accent)", bg: "var(--brand-accent)" },
    {
      label: "Files This Week",
      value: filesThisWeek === null ? "0" : String(filesThisWeek),
      sub: filesThisWeek === 0 ? "No uploads this week" : "Last 7 days · your department",
      icon: Upload, color: "#3b82f6", bg: "#3b82f6",
      loading: filesThisWeek === null,
    },
    // No approval workflow yet — sample.
    { label: "Pending Approvals", value: String(pendingCount), sub: "Awaiting review (sample)", icon: Clock, color: "#f59e0b", bg: "#f59e0b" },
    {
      label: "Active Team Members",
      value: String(deptUserStats.active),
      sub: `out of ${deptUserStats.total} total`,
      icon: Users, color: "#22c55e", bg: "#22c55e",
      loading: usersQ.isLoading,
    },
  ];

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <h2 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
            Admin Dashboard
          </h2>
          <span style={{ padding: "3px 10px", background: "#3b82f615", border: "1px solid #3b82f630", borderRadius: "20px", fontSize: "11px", fontWeight: 600, color: "#3b82f6" }}>
            {user.department}
          </span>
        </div>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          Welcome back, {user.name.split(" ")[0]}. Here's your department overview.
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label}
              style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4", transition: "transform 0.2s, box-shadow 0.2s", cursor: "default" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "none"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)"; }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "12px" }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: `${card.bg}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={18} color={card.color} />
                </div>
              </div>
              {card.loading ? (
                <div style={{ marginBottom: "6px" }}>
                  <Skeleton width={84} height={26} rounded="md" />
                </div>
              ) : (
                <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--brand-primary)", lineHeight: 1.1, fontFamily: "'Poppins', sans-serif" }}>{card.value}</div>
              )}
              <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px", fontFamily: "'Poppins', sans-serif" }}>{card.label}</div>
              {card.loading ? (
                <div style={{ marginTop: "6px" }}>
                  <Skeleton width={150} height={10} rounded="md" />
                </div>
              ) : (
                <div style={{ fontSize: "11px", color: card.color, marginTop: "4px", fontWeight: 500 }}>{card.sub}</div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
        {/* Weekly uploads chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: "0 0 2px", fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Files Uploaded This Week</h3>
              <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>Department activity</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "#22c55e", fontSize: "12px", fontWeight: 600 }}>
              <TrendingUp size={14} />
              +18%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={weeklyUploads} barSize={24}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f5f7" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "Poppins" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "Poppins" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "10px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "12px", fontFamily: "Poppins" }} />
              <Bar dataKey="files" fill="#3b82f6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Department storage breakdown */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Department Storage Usage</h3>
          {storageItems.map((item) => (
            <div key={item.label} style={{ marginBottom: "14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "5px" }}>
                <span style={{ fontSize: "12px", color: "#4b5563", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}>{item.label}</span>
                <span style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{item.used} / {item.total} GB</span>
              </div>
              <div style={{ height: "8px", background: "#f4f5f7", borderRadius: "10px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${(item.used / item.total) * 100}%`, background: item.color, borderRadius: "10px", transition: "width 0.5s ease" }} />
              </div>
            </div>
          ))}
          <div style={{ marginTop: "16px", padding: "10px 14px", background: "#f8f9fc", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", color: "#4b5563", fontFamily: "'Poppins', sans-serif" }}>Total Used</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>183 GB / 500 GB</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Pending File Approvals */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Pending Approvals</h3>
              {pendingCount > 0 && (
                <span style={{ background: "#fef3c7", color: "#d97706", fontSize: "11px", fontWeight: 700, borderRadius: "20px", padding: "2px 8px" }}>{pendingCount}</span>
              )}
            </div>
            <button onClick={() => setScreen("files")}
              style={{ fontSize: "12px", color: "var(--brand-accent)", fontWeight: 600, background: "none", border: "none", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
              View All →
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {pendingFiles.map((f) => (
              <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${f.status === "approved" ? "#bbf7d030" : f.status === "rejected" ? "#fecaca30" : "#f4f5f7"}`, background: f.status === "approved" ? "#f0fdf4" : f.status === "rejected" ? "#fef2f2" : "#f9fafb" }}>
                <div style={{ width: "34px", height: "34px", borderRadius: "8px", background: f.type === "PDF" ? "#fef2f2" : f.type === "DOC" ? "#eff6ff" : "#f5f3ff", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <FileText size={16} color={f.type === "PDF" ? "#ef4444" : f.type === "DOC" ? "#3b82f6" : "#8b5cf6"} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>by {f.uploadedBy} · {f.size}</div>
                </div>
                {f.status === "pending" ? (
                  <div style={{ display: "flex", gap: "5px" }}>
                    <button onClick={() => handleApprove(f.id)}
                      style={{ width: "28px", height: "28px", borderRadius: "7px", background: "#f0fdf4", border: "1px solid #bbf7d0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      title="Approve">
                      <Check size={13} color="#22c55e" />
                    </button>
                    <button onClick={() => handleReject(f.id)}
                      style={{ width: "28px", height: "28px", borderRadius: "7px", background: "#fef2f2", border: "1px solid #fecaca", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                      title="Reject">
                      <X size={13} color="#ef4444" />
                    </button>
                  </div>
                ) : (
                  <span style={{ fontSize: "11px", fontWeight: 600, color: f.status === "approved" ? "#22c55e" : "#ef4444", textTransform: "capitalize" }}>
                    {f.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Recent Team Activity — dept only */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Team Activity</h3>
            <div style={{ padding: "3px 8px", background: "#eff6ff", borderRadius: "6px", fontSize: "10px", fontWeight: 600, color: "#3b82f6" }}>
              {user.department} only
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {logsQ.isLoading && (
              <>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={`sk-${i}`} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < 4 ? "1px solid #f9fafb" : "none" }}>
                    <Skeleton width={30} height={30} rounded="md" />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <Skeleton width="60%" height={11} rounded="md" />
                      <Skeleton width="40%" height={10} rounded="md" />
                    </div>
                    <Skeleton width={56} height={10} rounded="md" />
                  </div>
                ))}
              </>
            )}
            {!logsQ.isLoading && recentTeamEvents.length === 0 && (
              <div style={{ padding: "8px 0", color: "#9ca3af", fontSize: "12px" }}>No recent activity in your department.</div>
            )}
            {!logsQ.isLoading && recentTeamEvents.map((a, i) => {
              const target = targetOf(a);
              const initials = a.actorName.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
              return (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < recentTeamEvents.length - 1 ? "1px solid #f9fafb" : "none" }}>
                  <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: "#3b82f615", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "#3b82f6", flexShrink: 0 }}>
                    {initials || "??"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", lineHeight: 1.4 }}>
                      <strong>{a.actorName}</strong> {shortVerb(a.action)}{" "}
                      {target && (
                        <span style={{ color: "var(--brand-primary)", fontWeight: 500 }}>{target}</span>
                      )}
                    </p>
                  </div>
                  <span style={{ fontSize: "11px", color: "#9ca3af", flexShrink: 0 }}>
                    {nowMs === null ? "—" : adminRelTime(a.timestamp, nowMs)}
                  </span>
                </div>
              );
            })}
          </div>
          <button onClick={() => setScreen("audit")}
            style={{ width: "100%", marginTop: "14px", padding: "10px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "12px", fontWeight: 600, color: "#6b7280", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f0f4ff")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc")}>
            <Eye size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
            View Full Activity Log (Read Only)
          </button>
        </div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginTop: "20px" }}>
        {[
          { label: "Upload Files",    icon: Upload,       color: "#3b82f6", action: () => setScreen("files") },
          { label: "Browse Folders",  icon: FolderOpen,   color: "var(--brand-accent)", action: () => setScreen("files") },
          { label: "View Audit Log",  icon: AlertCircle,  color: "#8b5cf6", action: () => setScreen("audit") },
        ].map((btn) => {
          const Icon = btn.icon;
          return (
            <button key={btn.label} onClick={btn.action}
              style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 18px", background: "white", border: `1px solid ${btn.color}20`, borderRadius: "12px", cursor: "pointer", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", transition: "all 0.15s", fontFamily: "'Poppins', sans-serif" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = `${btn.color}08`; (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "white"; (e.currentTarget as HTMLButtonElement).style.transform = "none"; }}>
              <div style={{ width: "34px", height: "34px", borderRadius: "9px", background: `${btn.color}15`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Icon size={16} color={btn.color} />
              </div>
              <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)" }}>{btn.label}</span>
              <CheckCircle size={14} color="#d1d5db" style={{ marginLeft: "auto" }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
