"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, FolderLock, ScrollText, HardDrive, Settings,
  LogOut, Bell, FolderOpen, ChevronDown, X, CheckCheck, Trash2,
  Upload, Shield,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useBranding } from "@/lib/queries/branding";
import { useMyTabAccess } from "@/lib/queries/tab-permissions";
import { TAB_LABELS, TAB_ROUTES, TAB_NAMES, type TabName } from "@/lib/tabs";
import type { Screen, User, Role } from "@/lib/types";

// Fallback logo when no custom logo has been uploaded yet (or the BFF call fails).
const FALLBACK_LOGO = "/imports/HTS_Logo_W.png";

interface LayoutProps {
  user: User;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavItem {
  id: Screen;
  label: string;
  icon: LucideIcon;
}

const NAV_BY_ROLE: Record<Role, NavItem[]> = {
  super_admin: [
    { id: "dashboard", label: "Dashboard",            icon: LayoutDashboard },
    { id: "users",     label: "User Management",       icon: Users },
    { id: "folders",   label: "Folder Access Control", icon: FolderLock },
    { id: "tabs",      label: "Tab Access Control",    icon: Shield },
    { id: "files",     label: "File Manager",          icon: FolderOpen },
    { id: "audit",     label: "Audit Logs",            icon: ScrollText },
    { id: "storage",   label: "Storage Overview",      icon: HardDrive },
    { id: "settings",  label: "Settings",              icon: Settings },
  ],
  admin: [
    { id: "dashboard", label: "Dashboard",          icon: LayoutDashboard },
    { id: "files",     label: "My Folders",         icon: FolderOpen },
    { id: "audit",     label: "Audit Logs",         icon: ScrollText },
    { id: "settings",  label: "Settings",           icon: Settings },
  ],
  manager: [
    { id: "dashboard", label: "Dashboard",   icon: LayoutDashboard },
    { id: "files",     label: "My Folders",  icon: FolderOpen },
  ],
  team_lead: [
    { id: "dashboard", label: "Dashboard",        icon: LayoutDashboard },
    { id: "files",     label: "My Folders",       icon: FolderOpen },
  ],
  lead_dev: [
    { id: "dashboard", label: "Dashboard",        icon: LayoutDashboard },
    { id: "files",     label: "My Folders",       icon: FolderOpen },
  ],
  team_member: [
    { id: "dashboard", label: "Dashboard",        icon: LayoutDashboard },
    { id: "files",     label: "My Folders",       icon: FolderOpen },
  ],
};

const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  team_lead: "Team Lead",
  lead_dev: "Lead Developer",
  team_member: "Team Member",
};

const ROLE_BADGE_COLORS: Record<Role, string> = {
  super_admin: "var(--brand-accent)",
  admin: "#3b82f6",
  manager: "#8b5cf6",
  team_lead: "#22c55e",
  lead_dev: "#06b6d4",
  team_member: "#f59e0b",
};

const screenTitles: Record<Screen, string> = {
  login: "Login", dashboard: "Dashboard", users: "User Management",
  folders: "Folder Access Control", tabs: "Tab Access Control",
  audit: "Audit Logs", files: "File Manager",
  storage: "Storage Overview", settings: "Settings", profile: "My Profile", upload: "Upload Files",
};

interface Notif {
  id: number;
  text: string;
  time: string;
  type: "warning" | "info" | "danger";
  read: boolean;
}

const initialNotifs: Notif[] = [
  { id: 1, text: "Ali Hassan downloaded Payroll_Dec.pdf", time: "2 mins ago", type: "warning", read: false },
  { id: 2, text: "New file uploaded in Projects folder", time: "10 mins ago", type: "info", read: false },
  { id: 3, text: "Failed login attempt detected from 45.33.21.100", time: "1 hour ago", type: "danger", read: false },
  { id: 4, text: "Storage 80% full warning", time: "Today", type: "warning", read: false },
];

const notifColors = { danger: "#ef4444", warning: "#f59e0b", info: "#3b82f6" };

/**
 * Vite → Next port: the screen-state-machine became file-based routing.
 *  - `currentScreen` is derived from the URL via usePathname() instead of being passed in.
 *  - `setScreen(id)` becomes router.push("/" + id).
 *  - logout still calls the prop (the (app)/layout wires it to useAuth().logout()).
 */
export function Layout({ user, onLogout, children }: LayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  // pathname is "/dashboard", "/files", etc. — strip the leading slash for the Screen id.
  const seg = (pathname?.split("/").filter(Boolean)[0] ?? "dashboard") as Screen;
  const currentScreen: Screen = (Object.keys(screenTitles) as Screen[]).includes(seg) ? seg : "dashboard";

  const setScreen = (s: Screen) => router.push("/" + s);

  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [notifs, setNotifs] = useState<Notif[]>(initialNotifs);

  // Nav is driven by the tab permission engine for non-super-admin users:
  // a Dashboard entry is always shown, plus every tab whose level is at
  // least 'view'. Super admins get the full nav (including Tab Access
  // Control) without hitting the engine. Until myTabAccess loads we render
  // just Dashboard so the sidebar isn't empty.
  const myTabAccess = useMyTabAccess();
  const superAdminNav = NAV_BY_ROLE.super_admin;
  const navItems = (() => {
    if (user.role === "super_admin") return superAdminNav;
    const dashboard = superAdminNav.find((n) => n.id === "dashboard")!;
    const access = myTabAccess.data;
    if (!access) return [dashboard];
    const visible: NavItem[] = [dashboard];
    for (const tab of TAB_NAMES) {
      if (access[tab] === "no_access") continue;
      const route = TAB_ROUTES[tab].replace(/^\//, "") as Screen;
      const fromSuper = superAdminNav.find((n) => n.id === route);
      if (fromSuper) visible.push(fromSuper);
      else visible.push({ id: route, label: TAB_LABELS[tab], icon: FolderOpen });
    }
    return visible;
  })();
  const unreadCount = notifs.filter(n => !n.read).length;
  const roleLabel = ROLE_LABELS[user.role];
  const roleBadgeColor = ROLE_BADGE_COLORS[user.role];
  // roleBadgeColor for super_admin is `var(--brand-accent)` (so brand re-coloring
  // works), but every other role is a hex literal. Concatenating alpha bytes
  // (e.g. `${color}cc`) yields valid 8-char hex for the literals but invalid
  // CSS like `var(--brand-accent)cc` for super_admin — which renders as no
  // background and the white pill behind it shows through. color-mix() works
  // uniformly for both forms, so all translucent variants go through this.
  const roleBadgeAlpha = (pct: number) =>
    `color-mix(in srgb, ${roleBadgeColor} ${pct}%, transparent)`;

  // Live branding (cached + refetched after Settings save).
  const { data: branding } = useBranding();
  const logoSrc = branding?.logoUrl ?? FALLBACK_LOGO;
  const companyName = branding?.companyName ?? "HexaTech Vault";

  const markAllRead = () => {
    setNotifs(prev => prev.map(n => ({ ...n, read: true })));
    toast.success("All notifications marked as read");
  };

  const dismissNotif = (id: number) => {
    setNotifs(prev => prev.filter(n => n.id !== id));
  };

  const markRead = (id: number) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const clearAll = () => {
    setNotifs([]);
    setNotifOpen(false);
    toast.success("All notifications cleared");
  };

  const handleLogout = () => {
    toast.success("Logged out successfully");
    setTimeout(onLogout, 500);
  };

  // Navigate to audit only if allowed
  const goToAudit = () => {
    if (navItems.some(n => n.id === "audit")) {
      setScreen("audit");
      setNotifOpen(false);
    } else {
      toast.error("You don't have access to Audit Logs");
      setNotifOpen(false);
    }
  };

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", fontFamily: "'Poppins', sans-serif", background: "#F5F7FA" }}>
      {/* Sidebar */}
      <aside style={{ width: sidebarCollapsed ? "72px" : "256px", minWidth: sidebarCollapsed ? "72px" : "256px", background: "linear-gradient(180deg, var(--brand-primary) 0%, #0f1e38 100%)", display: "flex", flexDirection: "column", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)", position: "relative", zIndex: 20, boxShadow: "4px 0 24px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* Texture */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.015'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`, pointerEvents: "none" }} />
        <svg style={{ position: "absolute", bottom: 0, right: 0, opacity: 0.04, pointerEvents: "none" }} width="200" height="200" viewBox="0 0 200 200">
          <circle cx="160" cy="160" r="140" fill="var(--brand-accent)" />
        </svg>

        {/* Logo */}
        <div style={{ padding: sidebarCollapsed ? "20px 16px" : "24px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer", transition: "padding 0.3s" }}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}>
          <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "rgba(201,168,76,0.15)", border: "1px solid rgba(201,168,76,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <img src={logoSrc} alt={companyName} style={{ width: "24px", height: "24px", objectFit: "contain" }} />
          </div>
          {!sidebarCollapsed && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ color: "white", fontSize: "15px", fontWeight: 700, letterSpacing: "-0.2px", lineHeight: 1.2, whiteSpace: "nowrap" }}>{companyName}</div>
              <div style={{ color: "var(--brand-accent)", fontSize: "10px", fontWeight: 500, letterSpacing: "1.5px", textTransform: "uppercase", opacity: 0.8 }}>File Management</div>
            </div>
          )}
        </div>

        {/* User badge with role */}
        {!sidebarCollapsed && (
          <div style={{ padding: "14px 20px 10px" }}>
            <div style={{ background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: "8px", padding: "8px 12px", display: "flex", alignItems: "center", gap: "8px" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `linear-gradient(135deg, ${roleBadgeAlpha(80)}, ${roleBadgeColor})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, color: "white", flexShrink: 0 }}>{user.avatar}</div>
              <div style={{ overflow: "hidden", flex: 1 }}>
                <div style={{ color: "white", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.name}</div>
                <div style={{ color: roleBadgeColor, fontSize: "10px", opacity: 0.9 }}>{roleLabel}</div>
              </div>
            </div>
            {/* Access level badge */}
            <div style={{ display: "flex", alignItems: "center", gap: "5px", marginTop: "6px", padding: "0 4px" }}>
              <Shield size={10} color="rgba(255,255,255,0.3)" />
              <span style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", fontFamily: "'Poppins', sans-serif" }}>
                {user.role === "super_admin" ? "Full System Access" :
                 user.role === "admin" ? "Department Management" :
                 user.role === "manager" ? "Team & Folder Access" :
                 "Assigned Folders Only"}
              </span>
            </div>
          </div>
        )}

        {/* Nav */}
        <nav style={{ flex: 1, padding: "8px 12px", overflowY: "auto", overflowX: "hidden" }}>
          {!sidebarCollapsed && (
            <div style={{ color: "rgba(255,255,255,0.25)", fontSize: "10px", fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", padding: "8px 8px 6px" }}>Navigation</div>
          )}
          {navItems.map((item) => {
            const active = currentScreen === item.id;
            const Icon = item.icon;
            return (
              <button key={item.id} onClick={() => setScreen(item.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: sidebarCollapsed ? "11px" : "10px 12px", borderRadius: "10px", border: "none", background: active ? "rgba(201,168,76,0.12)" : "transparent", cursor: "pointer", marginBottom: "2px", transition: "all 0.15s", position: "relative", justifyContent: sidebarCollapsed ? "center" : "flex-start" }}
                title={sidebarCollapsed ? item.label : undefined}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.06)"; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                {active && <div style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: "3px", height: "60%", background: "linear-gradient(180deg, var(--brand-accent), #e8c96a)", borderRadius: "0 3px 3px 0" }} />}
                <Icon size={17} color={active ? "var(--brand-accent)" : "rgba(255,255,255,0.5)"} style={{ flexShrink: 0 }} />
                {!sidebarCollapsed && (
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
                    <span style={{ color: active ? "#e8c96a" : "rgba(255,255,255,0.6)", fontSize: "13px", fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}>{item.label}</span>
                    {/* Read-only badge for admin audit */}
                    {item.id === "audit" && user.role === "admin" && (
                      <span style={{ fontSize: "9px", background: "rgba(59,130,246,0.2)", color: "#60a5fa", borderRadius: "4px", padding: "1px 5px", fontWeight: 600, letterSpacing: "0.5px" }}>READ</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}

          {/* Upload shortcut for non-super-admin roles */}
          {!sidebarCollapsed && user.role !== "super_admin" && (
            <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                onClick={() => { setScreen("files"); toast.info("Opening file upload..."); }}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(201,168,76,0.3)", background: "rgba(201,168,76,0.08)", cursor: "pointer", color: "var(--brand-accent)", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(201,168,76,0.16)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(201,168,76,0.08)")}>
                <Upload size={15} color="var(--brand-accent)" />
                Upload Files
              </button>
            </div>
          )}
        </nav>

        {/* Logout */}
        <div style={{ padding: "12px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button onClick={handleLogout}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: "10px", padding: sidebarCollapsed ? "11px" : "10px 12px", borderRadius: "10px", border: "none", background: "transparent", cursor: "pointer", justifyContent: sidebarCollapsed ? "center" : "flex-start", transition: "background 0.15s" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.1)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}>
            <LogOut size={17} color="rgba(239,68,68,0.7)" style={{ flexShrink: 0 }} />
            {!sidebarCollapsed && <span style={{ color: "rgba(239,68,68,0.7)", fontSize: "13px", fontWeight: 500 }}>Logout</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Header */}
        <header style={{ height: "64px", background: "white", borderBottom: "1px solid #eef0f4", display: "flex", alignItems: "center", padding: "0 28px", gap: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", flexShrink: 0, position: "relative", zIndex: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#9ca3af", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }}>{companyName}</span>
              <span style={{ color: "#d1d5db" }}>›</span>
              <span style={{ color: "var(--brand-primary)", fontSize: "14px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>{screenTitles[currentScreen]}</span>
            </div>
          </div>

          {/* Role chip */}
          <div style={{ padding: "4px 10px", borderRadius: "20px", background: roleBadgeAlpha(8), border: `1px solid ${roleBadgeAlpha(18)}`, fontSize: "11px", fontWeight: 600, color: roleBadgeColor, fontFamily: "'Poppins', sans-serif" }}>
            {roleLabel}
          </div>

          {/* Notifications */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); }}
              style={{ width: "38px", height: "38px", borderRadius: "10px", border: "1.5px solid #f0f0f0", background: "#f8f9fc", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
              <Bell size={17} color="#6b7280" />
              {unreadCount > 0 && (
                <div style={{ position: "absolute", top: "6px", right: "6px", minWidth: "16px", height: "16px", background: "#ef4444", borderRadius: "100px", border: "2px solid white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", color: "white", fontWeight: 700, fontFamily: "'Poppins', sans-serif", padding: "0 3px" }}>
                  {unreadCount}
                </div>
              )}
            </button>

            {notifOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "360px", background: "white", borderRadius: "16px", boxShadow: "0 20px 60px rgba(0,0,0,0.12)", border: "1px solid #eef0f4", zIndex: 100, overflow: "hidden" }}>
                <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f4f5f7", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontWeight: 600, fontSize: "14px", color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Notifications</span>
                    {unreadCount > 0 && <span style={{ background: "#ef4444", color: "white", fontSize: "10px", fontWeight: 700, borderRadius: "100px", padding: "1px 7px", fontFamily: "'Poppins', sans-serif" }}>{unreadCount}</span>}
                  </div>
                  <div style={{ display: "flex", gap: "4px" }}>
                    {unreadCount > 0 && (
                      <button onClick={markAllRead}
                        style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", background: "#f0f9f4", border: "1px solid #bbf7d0", borderRadius: "7px", cursor: "pointer", fontSize: "11px", color: "#16a34a", fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>
                        <CheckCheck size={11} /> Mark all read
                      </button>
                    )}
                    {notifs.length > 0 && (
                      <button onClick={clearAll}
                        style={{ display: "flex", alignItems: "center", gap: "4px", padding: "4px 10px", background: "#f8f9fc", border: "1px solid #e5e7eb", borderRadius: "7px", cursor: "pointer", fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>
                        <Trash2 size={11} /> Clear
                      </button>
                    )}
                    <button onClick={() => setNotifOpen(false)}
                      style={{ background: "#f8f9fc", border: "1px solid #e5e7eb", borderRadius: "7px", width: "26px", height: "26px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <X size={13} color="#6b7280" />
                    </button>
                  </div>
                </div>

                {notifs.length === 0 ? (
                  <div style={{ padding: "32px 20px", textAlign: "center" }}>
                    <Bell size={24} color="#d1d5db" style={{ margin: "0 auto 8px", display: "block" }} />
                    <p style={{ margin: 0, fontSize: "13px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>No notifications</p>
                  </div>
                ) : (
                  notifs.map((n) => (
                    <div key={n.id} style={{ padding: "12px 20px", borderBottom: "1px solid #f9fafb", display: "flex", gap: "10px", alignItems: "flex-start", background: n.read ? "white" : `${notifColors[n.type]}04`, cursor: "pointer", transition: "background 0.1s" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = n.read ? "white" : `${notifColors[n.type]}04`)}
                      onClick={() => markRead(n.id)}>
                      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: n.read ? "#d1d5db" : notifColors[n.type], flexShrink: 0, marginTop: "5px" }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: "0 0 2px", fontSize: "13px", color: n.read ? "#6b7280" : "#374151", fontFamily: "'Poppins', sans-serif", lineHeight: 1.4, fontWeight: n.read ? 400 : 500 }}>{n.text}</p>
                        <span style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{n.time}</span>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); dismissNotif(n.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#d1d5db", flexShrink: 0, padding: "2px" }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#ef4444")}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = "#d1d5db")}>
                        <X size={13} />
                      </button>
                    </div>
                  ))
                )}

                {notifs.length > 0 && (
                  <button onClick={goToAudit}
                    style={{ width: "100%", padding: "12px 20px", textAlign: "center", color: "var(--brand-accent)", fontSize: "12px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif", background: "none", border: "none", borderTop: "1px solid #f4f5f7" }}>
                    View full audit log →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Profile */}
          <div style={{ position: "relative" }}>
            <button onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 10px 6px 6px", border: "1.5px solid #f0f0f0", borderRadius: "12px", background: "#f8f9fc", cursor: "pointer" }}>
              <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `linear-gradient(135deg, ${roleBadgeAlpha(80)}, ${roleBadgeColor})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "white" }}>{user.avatar}</div>
              <div style={{ textAlign: "left" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", lineHeight: 1.2 }}>{user.name.split(" ")[0]}</div>
                <div style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{roleLabel}</div>
              </div>
              <ChevronDown size={13} color="#9ca3af" />
            </button>

            {profileOpen && (
              <div style={{ position: "absolute", top: "calc(100% + 10px)", right: 0, width: "200px", background: "white", borderRadius: "14px", boxShadow: "0 20px 60px rgba(0,0,0,0.12)", border: "1px solid #eef0f4", zIndex: 100, overflow: "hidden" }}>
                <div style={{ padding: "16px", borderBottom: "1px solid #f4f5f7", background: "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 3%, transparent), color-mix(in srgb, var(--brand-primary) 2%, transparent))" }}>
                  <div style={{ fontWeight: 600, color: "var(--brand-primary)", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>{user.name}</div>
                  <div style={{ color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>{user.email}</div>
                  <div style={{ marginTop: "6px", display: "inline-flex", padding: "2px 8px", background: roleBadgeAlpha(8), borderRadius: "10px", fontSize: "10px", fontWeight: 600, color: roleBadgeColor, fontFamily: "'Poppins', sans-serif" }}>
                    {roleLabel}
                  </div>
                </div>
                <button onClick={() => { setScreen("profile"); setProfileOpen(false); }}
                  style={{ width: "100%", padding: "11px 16px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#4b5563", fontFamily: "'Poppins', sans-serif", borderBottom: "1px solid #f9fafb" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}>
                  My Profile
                </button>
                {navItems.some(n => n.id === "settings") && (
                  <button onClick={() => { setScreen("settings"); setProfileOpen(false); }}
                    style={{ width: "100%", padding: "11px 16px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#4b5563", fontFamily: "'Poppins', sans-serif", borderBottom: "1px solid #f9fafb" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}>
                    Settings
                  </button>
                )}
                {navItems.some(n => n.id === "audit") && (
                  <button onClick={() => { setScreen("audit"); setProfileOpen(false); }}
                    style={{ width: "100%", padding: "11px 16px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#4b5563", fontFamily: "'Poppins', sans-serif", borderBottom: "1px solid #f9fafb" }}
                    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc")}
                    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}>
                    My Activity
                  </button>
                )}
                <button onClick={handleLogout}
                  style={{ width: "100%", padding: "11px 16px", textAlign: "left", background: "none", border: "none", cursor: "pointer", fontSize: "13px", color: "#ef4444", fontFamily: "'Poppins', sans-serif" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#fef2f2")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "none")}>
                  Sign Out
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflow: "auto", background: "#F5F7FA" }}
          onClick={() => { setNotifOpen(false); setProfileOpen(false); }}>
          {children}
        </main>
      </div>
    </div>
  );
}
