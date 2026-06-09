"use client";

import {
  FolderOpen, Upload, Users, Activity, ExternalLink,
  TrendingUp, Eye,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { toast } from "sonner";
import type { Screen, User } from "@/lib/types";

interface Props {
  user: User;
  setScreen: (s: Screen) => void;
}

const teamUploads = [
  { day: "Mon", files: 3 },
  { day: "Tue", files: 7 },
  { day: "Wed", files: 5 },
  { day: "Thu", files: 11 },
  { day: "Fri", files: 8 },
  { day: "Sat", files: 1 },
  { day: "Sun", files: 0 },
];

const teamMembers = [
  { name: "Raza Malik",  role: "Lead Dev",    status: "online",  avatar: "RM", files: 12, color: "#06b6d4" },
  { name: "Ali Hassan",  role: "Team Lead",   status: "online",  avatar: "AH", files: 8,  color: "#22c55e" },
  { name: "Hina Baig",   role: "CRM Expert",  status: "away",    avatar: "HB", files: 6,  color: "#f59e0b" },
  { name: "Bilal Qureshi", role: "Developer", status: "offline", avatar: "BQ", files: 3,  color: "#8b5cf6" },
];

const recentTeamUploads = [
  { name: "ProjectAlpha_Architecture_v3.pdf", by: "Raza Malik",  size: "3.2 MB", time: "10 min ago", folder: "Project Alpha", color: "#ef4444" },
  { name: "Sprint_Planning_Notes.docx",       by: "Ali Hassan",  size: "0.8 MB", time: "1 hr ago",   folder: "Projects",     color: "#3b82f6" },
  { name: "CRM_Pipeline_Report.xlsx",         by: "Hina Baig",   size: "1.5 MB", time: "2 hrs ago",  folder: "CRM Reports",  color: "#22c55e" },
  { name: "Loom_Demo_Recording_Link",          by: "Raza Malik",  size: "—",      time: "3 hrs ago",  folder: "Project Alpha", color: "#8b5cf6" },
];

const myRecentFiles = [
  { name: "Q1_Manager_Report.pdf",    folder: "Projects",    time: "Today",      size: "2.1 MB" },
  { name: "Team_Goals_2026.docx",     folder: "HR & Admin",  time: "Yesterday",  size: "0.5 MB" },
  { name: "Site_Migration_Plan.xlsx", folder: "WordPress",   time: "3 days ago", size: "1.2 MB" },
];

const statusColors: Record<string, string> = { online: "#22c55e", away: "#f59e0b", offline: "#9ca3af" };

export function ManagerDashboard({ user, setScreen }: Props) {
  const onlineCount = teamMembers.filter(m => m.status === "online").length;

  const statCards = [
    { label: "Team Members Online", value: `${onlineCount}/${teamMembers.length}`, sub: "right now",            icon: Users,    color: "#22c55e" },
    { label: "Team Uploads",         value: "35",                                  sub: "this week",            icon: Upload,   color: "#3b82f6" },
    { label: "My Assigned Folders",  value: "8",                                   sub: "active folders",       icon: FolderOpen, color: "var(--brand-accent)" },
    { label: "Dept Storage",         value: "200 GB",                              sub: "of 500 GB used",       icon: Activity, color: "#8b5cf6" },
  ];

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <h2 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
            Manager Dashboard
          </h2>
          <span style={{ padding: "3px 10px", background: "#8b5cf615", border: "1px solid #8b5cf630", borderRadius: "20px", fontSize: "11px", fontWeight: 600, color: "#8b5cf6" }}>
            {user.department}
          </span>
        </div>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          Welcome back, {user.name.split(" ")[0]}. Monitor your team's activity below.
        </p>
      </div>

      {/* Stat Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {statCards.map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label}
              style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4", cursor: "default", transition: "transform 0.2s, box-shadow 0.2s" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "none"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)"; }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: `${card.color}15`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
                <Icon size={18} color={card.color} />
              </div>
              <div style={{ fontSize: "26px", fontWeight: 700, color: "var(--brand-primary)", lineHeight: 1.1, fontFamily: "'Poppins', sans-serif" }}>{card.value}</div>
              <div style={{ fontSize: "13px", color: "#6b7280", marginTop: "4px", fontFamily: "'Poppins', sans-serif" }}>{card.label}</div>
              <div style={{ fontSize: "11px", color: card.color, marginTop: "4px", fontWeight: 500 }}>{card.sub}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "20px", marginBottom: "20px" }}>
        {/* Team uploads chart */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: "0 0 2px", fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Team Upload Activity</h3>
              <p style={{ margin: 0, fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>Files uploaded this week</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", color: "#22c55e", fontSize: "12px", fontWeight: 600 }}>
              <TrendingUp size={14} />+22%
            </div>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={teamUploads}>
              <defs>
                <linearGradient id="mgUploadGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f5f7" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "Poppins" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "Poppins" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ borderRadius: "10px", border: "none", boxShadow: "0 4px 20px rgba(0,0,0,0.1)", fontSize: "12px" }} />
              <Area type="monotone" dataKey="files" stroke="#8b5cf6" strokeWidth={2} fill="url(#mgUploadGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Team Members Online */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <h3 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Team Members</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {teamMembers.map((m) => (
              <div key={m.name} style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <div style={{ position: "relative" }}>
                  <div style={{ width: "34px", height: "34px", borderRadius: "10px", background: `${m.color}20`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: m.color }}>
                    {m.avatar}
                  </div>
                  <div style={{ position: "absolute", bottom: "-1px", right: "-1px", width: "10px", height: "10px", borderRadius: "50%", background: statusColors[m.status], border: "2px solid white" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{m.name}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{m.role}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: m.color }}>{m.files}</div>
                  <div style={{ fontSize: "10px", color: "#9ca3af" }}>files</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        {/* Recent Team Uploads — view only */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Recent Team Uploads</h3>
            <div style={{ padding: "3px 8px", background: "#fef3c7", borderRadius: "6px", fontSize: "10px", fontWeight: 600, color: "#d97706" }}>
              View Only
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {recentTeamUploads.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderRadius: "10px", background: "#f9fafb", border: "1px solid #f4f5f7" }}>
                <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${f.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {f.name.includes("_Link") ? <ExternalLink size={14} color={f.color} /> : <FolderOpen size={14} color={f.color} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{f.by} · {f.folder}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>{f.time}</div>
                  <div style={{ fontSize: "10px", color: "#9ca3af" }}>{f.size}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setScreen("files")}
            style={{ width: "100%", marginTop: "12px", padding: "10px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "12px", fontWeight: 600, color: "#6b7280", cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#eff6ff")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc")}>
            <Eye size={13} style={{ marginRight: "6px", verticalAlign: "middle" }} />
            Browse Team Folders
          </button>
        </div>

        {/* My Recent Files + Quick Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>My Recent Files</h3>
            {myRecentFiles.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "8px 0", borderBottom: i < myRecentFiles.length - 1 ? "1px solid #f9fafb" : "none" }}>
                <FolderOpen size={15} color="var(--brand-accent)" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 500, color: "#374151", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.name}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af" }}>{f.folder} · {f.time}</div>
                </div>
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>{f.size}</span>
              </div>
            ))}
          </div>

          {/* Quick Actions */}
          <div style={{ background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", borderRadius: "16px", padding: "20px", boxShadow: "0 4px 20px rgba(27,42,74,0.25)" }}>
            <h3 style={{ margin: "0 0 14px", fontSize: "14px", fontWeight: 600, color: "white", fontFamily: "'Poppins', sans-serif" }}>Quick Actions</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { label: "Upload Files",       icon: Upload,       action: () => setScreen("files") },
                { label: "Browse My Folders",  icon: FolderOpen,   action: () => setScreen("files") },
                { label: "Add External Link",  icon: ExternalLink, action: () => { setScreen("files"); toast.info("Use Add Link in File Manager"); } },
              ].map((btn) => {
                const Icon = btn.icon;
                return (
                  <button key={btn.label} onClick={btn.action}
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 14px", background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", cursor: "pointer", color: "white", fontSize: "13px", fontWeight: 500, fontFamily: "'Poppins', sans-serif", textAlign: "left", transition: "background 0.15s" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(201,168,76,0.2)")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.08)")}>
                    <Icon size={15} color="var(--brand-accent)" />
                    {btn.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
