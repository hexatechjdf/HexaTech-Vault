"use client";

import { useMemo, useState } from "react";
import {
  FolderOpen, Upload, Link, Clock, Lock,
  ExternalLink, CheckCircle, FileText, Play, Table2,
} from "lucide-react";
import { toast } from "sonner";
import type { Screen, User } from "@/lib/types";
import { useMyFolders } from "@/lib/queries/drive-files";
import { PERM_LABELS, PERM_COLORS } from "@/lib/permissions";
import { Skeleton } from "@/components/Loader";

interface Props {
  user: User;
  setScreen: (s: Screen) => void;
}

const ROLE_LABELS: Record<string, string> = {
  team_lead:  "Team Lead",
  lead_dev:   "Lead Developer",
  team_member: "Team Member",
};

const ROLE_COLORS: Record<string, string> = {
  team_lead:  "#22c55e",
  lead_dev:   "#06b6d4",
  team_member: "#f59e0b",
};

// Note: assigned folders are now resolved live via useMyFolders() — see the
// component body. The previous ASSIGNED_FOLDERS sample tree was removed; the
// dashboard now mirrors exactly what the File Manager's "My Folders" view
// shows for this user.

const savedLinks = [
  { title: "Sprint Demo Recording",    url: "https://loom.com/share/example1", type: "Loom",    icon: Play,       color: "#ef4444" },
  { title: "Team Standup Notes (Doc)", url: "https://docs.google.com/example", type: "Google Doc", icon: FileText, color: "#3b82f6" },
  { title: "Q2 OKR Spreadsheet",      url: "https://sheets.google.com/example", type: "Sheet",  icon: Table2,    color: "#22c55e" },
];

const myActivity = [
  { action: "Uploaded",   item: "Feature_Spec_v2.pdf",     time: "30 min ago", color: "#3b82f6" },
  { action: "Viewed",     item: "ProjectAlpha_Timeline.xlsx", time: "2 hrs ago", color: "#8b5cf6" },
  { action: "Downloaded", item: "Brand_Logo_Pack.zip",     time: "Yesterday",  color: "var(--brand-accent)" },
  { action: "Uploaded",   item: "Loom_Demo_Link",          time: "2 days ago", color: "#22c55e" },
];

export function TeamLeadDashboard({ user, setScreen }: Props) {
  const [, setActiveFolder] = useState<string | null>(null);
  const roleColor = ROLE_COLORS[user.role] ?? "#22c55e";
  const roleLabel = ROLE_LABELS[user.role] ?? "Team Member";

  // ── Live data ───────────────────────────────────────────────────────────
  // The "My Folders" entry point: every folder this user has any kind of
  // access to (assignee row / user grant / role grant / dept grant).
  const myFoldersQ = useMyFolders(true);

  // Map server-side DTOs to the shape this dashboard's row card expects.
  // - files     : DTO's itemCount (direct, non-deleted children)
  // - perm      : friendly label derived from myLevel
  // - color     : stable per-row swatch, derived from the level
  const folders = useMemo(() => {
    const list = myFoldersQ.data ?? [];
    return list.map((f) => ({
      id: f.id,
      name: f.name,
      files: typeof f.itemCount === "number" ? f.itemCount : 0,
      // Server already strips zero-access folders, so myLevel is never "no_access" here.
      perm: PERM_LABELS[f.myLevel] ?? "—",
      color: PERM_COLORS[f.myLevel] ?? roleColor,
    }));
  }, [myFoldersQ.data, roleColor]);
  const totalFiles = folders.reduce((s, f) => s + f.files, 0);

  const handleOpenFolder = (folder: { id: string; name: string; perm: string }) => {
    if (folder.perm === "No Access") {
      toast.error("You don't have access to this folder");
      return;
    }
    setActiveFolder(folder.id);
    setScreen("files");
    toast.success(`Opening ${folder.name}...`);
  };

  const handleCopyLink = (url: string, title: string) => {
    navigator.clipboard.writeText(url).then(() => {
      toast.success(`Link copied: ${title}`);
    }).catch(() => {
      toast.info(`Link: ${url}`);
    });
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
          <h2 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
            {roleLabel} Dashboard
          </h2>
          <span style={{ padding: "3px 10px", background: `${roleColor}15`, border: `1px solid ${roleColor}30`, borderRadius: "20px", fontSize: "11px", fontWeight: 600, color: roleColor }}>
            {user.department}
          </span>
        </div>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
          <span>Welcome back, {user.name.split(" ")[0]}.</span>
          {myFoldersQ.isLoading ? (
            <Skeleton width={240} height={11} rounded="md" />
          ) : (
            <span>You have access to {folders.length} assigned {folders.length === 1 ? "folder" : "folders"}.</span>
          )}
        </p>
      </div>

      {/* Stats row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
        {([
          {
            label: "Assigned Folders",
            value: String(folders.length),
            sub: "accessible to you",
            icon: FolderOpen,
            color: roleColor,
            loading: myFoldersQ.isLoading,
          },
          {
            label: "Total Files",
            value: String(totalFiles),
            sub: "items across all folders",
            icon: FileText,
            color: "#3b82f6",
            loading: myFoldersQ.isLoading,
          },
          // No saved-links feature yet — sample data, will wire when feature lands.
          { label: "Saved Links",       value: String(savedLinks.length), sub: "external resources (sample)", icon: Link,    color: "#8b5cf6" },
          // No per-user audit feed for these roles yet — sample.
          { label: "Recent Activity",   value: String(myActivity.length), sub: "this week (sample)",      icon: Clock,       color: "var(--brand-accent)" },
        ] as { label: string; value: string; sub: string; icon: typeof FolderOpen; color: string; loading?: boolean }[]).map((card) => {
          const Icon = card.icon;
          return (
            <div key={card.label}
              style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4", transition: "transform 0.2s, box-shadow 0.2s", cursor: "default" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "none"; (e.currentTarget as HTMLDivElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.05)"; }}>
              <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: `${card.color}15`, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "12px" }}>
                <Icon size={18} color={card.color} />
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
        {/* Assigned Folders */}
        <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>My Assigned Folders</h3>
            <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 8px", background: "#fef9ec", borderRadius: "6px", border: "1px solid #fde68a" }}>
              <Lock size={10} color="#d97706" />
              <span style={{ fontSize: "10px", color: "#d97706", fontWeight: 600 }}>Super Admin assigned</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {myFoldersQ.isLoading && (
              <>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={`sk-${i}`} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "12px", border: "1px solid #f4f5f7", background: "#f9fafb" }}>
                    <Skeleton width={38} height={38} rounded="md" />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <Skeleton width="55%" height={12} rounded="md" />
                      <Skeleton width="30%" height={10} rounded="md" />
                    </div>
                    <Skeleton width={66} height={18} rounded="pill" />
                  </div>
                ))}
              </>
            )}
            {!myFoldersQ.isLoading && folders.length === 0 && (
              <div style={{ padding: "16px 14px", borderRadius: "10px", border: "1px dashed #e5e7eb", color: "#9ca3af", fontSize: "12px", fontFamily: "'Poppins', sans-serif", textAlign: "center" }}>
                No folders have been shared with you yet. Ask your Super Admin to grant access.
              </div>
            )}
            {!myFoldersQ.isLoading && folders.map((folder) => (
              <div key={folder.id}
                onClick={() => handleOpenFolder(folder)}
                style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 14px", borderRadius: "12px", border: "1px solid #f4f5f7", background: "#f9fafb", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = `${folder.color}08`; (e.currentTarget as HTMLDivElement).style.borderColor = `${folder.color}30`; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#f9fafb"; (e.currentTarget as HTMLDivElement).style.borderColor = "#f4f5f7"; }}>
                <div style={{ width: "38px", height: "38px", borderRadius: "10px", background: `${folder.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <FolderOpen size={18} color={folder.color} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{folder.name}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
                    {folder.files} {folder.files === 1 ? "item" : "items"}
                  </div>
                </div>
                <span style={{ fontSize: "10px", fontWeight: 600, color: folder.color, padding: "2px 8px", borderRadius: "6px", background: `${folder.color}15`, whiteSpace: "nowrap" }}>
                  {folder.perm}
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => setScreen("files")}
            style={{ width: "100%", marginTop: "12px", padding: "10px", background: `${roleColor}10`, border: `1px solid ${roleColor}30`, borderRadius: "10px", fontSize: "12px", fontWeight: 600, color: roleColor, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = `${roleColor}20`)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = `${roleColor}10`)}>
            Open File Manager →
          </button>
        </div>

        {/* Saved Links */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4", flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Saved Links</h3>
              <button onClick={() => { setScreen("files"); toast.info("Use 'Add Link' button in File Manager"); }}
                style={{ fontSize: "12px", color: "var(--brand-accent)", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}>
                + Add Link
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {savedLinks.map((link, i) => {
                const Icon = link.icon;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", background: "#f9fafb", border: "1px solid #f4f5f7" }}>
                    <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: `${link.color}15`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <Icon size={14} color={link.color} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "12px", fontWeight: 500, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link.title}</div>
                      <div style={{ fontSize: "10px", color: "#9ca3af" }}>{link.type}</div>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button onClick={() => window.open(link.url, "_blank")}
                        style={{ width: "26px", height: "26px", borderRadius: "6px", background: "#eff6ff", border: "1px solid #dbeafe", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Open">
                        <ExternalLink size={11} color="#3b82f6" />
                      </button>
                      <button onClick={() => handleCopyLink(link.url, link.title)}
                        style={{ width: "26px", height: "26px", borderRadius: "6px", background: "#f0fdf4", border: "1px solid #bbf7d0", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
                        title="Copy Link">
                        <Link size={11} color="#22c55e" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Upload */}
          <div style={{ background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", borderRadius: "16px", padding: "18px 20px", boxShadow: "0 4px 20px rgba(27,42,74,0.25)", display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Upload size={20} color="var(--brand-accent)" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "white", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>Upload Files</div>
              <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "11px" }}>to your assigned folders</div>
            </div>
            <button onClick={() => setScreen("files")}
              style={{ padding: "8px 16px", background: "var(--brand-accent)", border: "none", borderRadius: "10px", color: "var(--brand-primary)", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#e8c96a")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "var(--brand-accent)")}>
              Upload
            </button>
          </div>
        </div>
      </div>

      {/* My Recent Activity */}
      <div style={{ background: "white", borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.05)", border: "1px solid #eef0f4" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>My Recent Activity</h3>
          <span style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>Last 7 days</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "10px" }}>
          {myActivity.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", background: "#f9fafb", borderRadius: "12px", border: "1px solid #f4f5f7" }}>
              <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: a.color, marginTop: "4px", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "11px", fontWeight: 600, color: a.color, fontFamily: "'Poppins', sans-serif", textTransform: "uppercase", letterSpacing: "0.5px" }}>{a.action}</div>
                <div style={{ fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", marginTop: "2px", lineHeight: 1.3 }}>{a.item}</div>
                <div style={{ fontSize: "11px", color: "#9ca3af", marginTop: "4px" }}>{a.time}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: "14px", padding: "10px 14px", background: "#fef9ec", border: "1px solid #fde68a", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
          <CheckCircle size={14} color="#d97706" />
          <span style={{ fontSize: "12px", color: "#92400e", fontFamily: "'Poppins', sans-serif" }}>
            All your file actions are logged automatically for security. Only Super Admin and Admins can view full audit logs.
          </span>
        </div>
      </div>
    </div>
  );
}
