"use client";

// Audit Logs screen — wired to GET /api/admin/audit-logs via React Query.
// No dummy data; RLS scopes which rows the caller sees.
//
// The `readOnly` prop renders an info badge + disables export/download.
// The `department` prop is now a UI label only — server RLS already restricts
// admins to their own department. Kept in the signature for prop compatibility.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, Filter, Download, AlertTriangle, Clock, Globe, X, FileText, Table, Eye, Lock, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { useAuditLogs, type AuditLogEntry } from "@/lib/queries/audit";
import { Pagination, paginate } from "@/components/Pagination";
import { Loader, SkeletonRows } from "@/components/Loader";

interface Props {
  readOnly?: boolean;
  department?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers — translate machine-y server values to human strings.
// ─────────────────────────────────────────────────────────────────────────────
const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  team_lead: "Team Lead",
  lead_dev: "Lead Dev",
  team_member: "Team Member",
};

const ACTION_LABEL: Record<string, string> = {
  "admin.user_create": "User Created",
  "admin.user_invite": "User Invited",
  "admin.user_delete": "User Deleted",
  "admin.user_role_change": "Role Changed",
  "admin.branding_update": "Branding Updated",
  "admin.branding_logo_upload": "Logo Uploaded",
  "drive.connect": "Drive Connected",
  "drive.sync": "Drive Sync",
  "folder.create": "Folder Created",
  "folder.delete": "Folder Deleted",
  "file.upload": "File Uploaded",
  "file.download": "File Downloaded",
  "file.delete": "File Deleted",
  "file.view": "File Viewed",
  "perm.grant": "Permission Changed",
  "perm.revoke": "Permission Revoked",
  "auth.login": "Login",
  "auth.failed_login": "Failed Login",
};

function actionLabel(code: string): string {
  return ACTION_LABEL[code] ?? code;
}

// Soft tag colors by action family. Falls back to neutral gray.
const ACTION_COLOR: Record<string, string> = {
  "admin.user_create": "var(--brand-accent)",
  "admin.user_invite": "var(--brand-accent)",
  "admin.user_delete": "#ef4444",
  "admin.user_role_change": "#8b5cf6",
  "admin.branding_update": "#3b82f6",
  "admin.branding_logo_upload": "#3b82f6",
  "drive.connect": "#22c55e",
  "drive.sync": "#06b6d4",
  "folder.create": "#22c55e",
  "folder.delete": "#ef4444",
  "file.upload": "#22c55e",
  "file.download": "#3b82f6",
  "file.delete": "#ef4444",
  "file.view": "#6b7280",
  "perm.grant": "#8b5cf6",
  "perm.revoke": "#8b5cf6",
  "auth.login": "#22c55e",
  "auth.failed_login": "#ef4444",
};

function actionColor(code: string): string {
  return ACTION_COLOR[code] ?? "#6b7280";
}

// Pull a human label for the "File / Target" column from action + details.
function resourceLabel(log: AuditLogEntry): string {
  const d = (log.details ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);

  if (log.action.startsWith("admin.user_")) {
    return str("email") ? `User: ${str("email")}` : (log.resourceId ? `User: ${log.resourceId}` : "—");
  }
  if (log.action === "admin.branding_update") {
    const cols = Object.keys(d).filter(
      (k) => !["updated_at", "updated_by"].includes(k) && d[k] != null,
    );
    return cols.length ? `Branding: ${cols.join(", ")}` : "Branding";
  }
  if (log.action === "admin.branding_logo_upload") return "Logo file";
  if (log.action.startsWith("drive.")) return "Drive connection";
  if (log.action.startsWith("folder.")) return str("path") ?? str("name") ?? log.resourceId ?? "—";
  if (log.action.startsWith("file.")) return str("name") ?? log.resourceId ?? "—";
  if (log.action.startsWith("perm.")) return str("folder_path") ?? log.resourceId ?? "—";
  return log.resourceId ?? "—";
}

function formatTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AuditLogs({ readOnly = false, department }: Props) {
  const logsQuery = useAuditLogs();
  const allLogs = useMemo(() => logsQuery.data ?? [], [logsQuery.data]);

  // When the user is sent here from User Management's "View Activity" action,
  // the URL carries ?actor=<name>. We pre-fill the search box so they land on
  // a filtered view immediately.
  const searchParams = useSearchParams();
  const actorParam = searchParams?.get("actor") ?? "";
  const [search, setSearch] = useState(actorParam);
  const [filterAction, setFilterAction] = useState("All");
  const [filterDate, setFilterDate] = useState("All Time");
  // Track open/closed state per dropdown so we can swap the chevron icon
  // (down when closed, up when open). The native <select> picker is a
  // browser/OS surface — we proxy "open" with focus, "closed" with blur.
  const [actionOpen, setActionOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [showSuspicious, setShowSuspicious] = useState(false);
  const [detailLog, setDetailLog] = useState<AuditLogEntry | null>(null);
  // Client-side pagination. Server returns the full filtered set; we slice in
  // memory because the audit log is small and React Query already caches it.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Actions removed from the filter dropdown even if historical rows exist.
  // `admin.user_invite` is here because the email-invite flow was removed
  // from the product (Settings → User Management); surfacing the option would
  // confuse anyone who never saw the feature.
  const HIDDEN_ACTION_OPTIONS = new Set<string>(["admin.user_invite"]);

  // Build the action filter dropdown from what's actually in the data so we
  // don't surface options that would always be empty — minus anything in the
  // hide-list above.
  const allActionCodes = useMemo(() => {
    const set = new Set(allLogs.map((l) => l.action));
    for (const hidden of HIDDEN_ACTION_OPTIONS) set.delete(hidden);
    return Array.from(set).sort();
  }, [allLogs]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const term = search.trim().toLowerCase();
    return allLogs.filter((l) => {
      const suspicious = l.result === "failure";
      const label = actionLabel(l.action).toLowerCase();
      const res = resourceLabel(l).toLowerCase();
      const matchSearch =
        !term ||
        l.actorName.toLowerCase().includes(term) ||
        label.includes(term) ||
        l.action.toLowerCase().includes(term) ||
        res.includes(term) ||
        (l.ipAddress ?? "").includes(term);
      const matchAction = filterAction === "All" || l.action === filterAction;
      const matchSuspicious = !showSuspicious || suspicious;

      let matchDate = true;
      if (filterDate !== "All Time") {
        const t = new Date(l.timestamp).getTime();
        if (Number.isFinite(t)) {
          if (filterDate === "Today") {
            const start = new Date(); start.setHours(0, 0, 0, 0);
            matchDate = t >= start.getTime();
          } else if (filterDate === "Last 7 Days") {
            matchDate = now - t <= 7 * 86400000;
          } else if (filterDate === "Last 30 Days") {
            matchDate = now - t <= 30 * 86400000;
          }
        }
      }
      return matchSearch && matchAction && matchSuspicious && matchDate;
    });
  }, [allLogs, search, filterAction, showSuspicious, filterDate]);

  // Reset to page 1 whenever the filter set changes so the user never lands
  // on a stale out-of-range page (e.g. switching from 'All' to a filter that
  // matches only 3 entries while they were on page 7).
  useEffect(() => { setPage(1); }, [search, filterAction, filterDate, showSuspicious]);

  const { pageItems: pageRows } = useMemo(
    () => paginate(filtered, page, pageSize),
    [filtered, page, pageSize],
  );

  const suspiciousCount = useMemo(
    () => allLogs.filter((l) => l.result === "failure").length,
    [allLogs],
  );

  const handleExportCSV = () => {
    if (readOnly) { toast.error("Export is disabled for your access level"); return; }
    const headers = ["Timestamp", "User", "Role", "Department", "Action", "Code", "Resource", "Result", "IP Address"];
    const rows = filtered.map((l) => [
      l.timestamp,
      l.actorName,
      l.actorRole ? (ROLE_LABEL[l.actorRole] ?? l.actorRole) : "—",
      l.actorDepartment ?? "—",
      actionLabel(l.action),
      l.action,
      resourceLabel(l),
      l.result,
      l.ipAddress ?? "—",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    downloadFile("audit_logs.csv", csv, "text/csv");
    toast.success(`Exported ${filtered.length} log entries to CSV`);
  };

  const handleExportText = () => {
    if (readOnly) { toast.error("Export is disabled for your access level"); return; }
    const lines = [
      "AUDIT LOG REPORT",
      `Generated: ${new Date().toISOString()} | Entries: ${filtered.length}`,
      "═══════════════════════════════════════════════════════════",
      "",
      ...filtered.map((l) =>
        `[${l.timestamp}] ${l.actorName} (${l.actorRole ?? "—"}) — ${actionLabel(l.action)} — ${resourceLabel(l)}\n  IP: ${l.ipAddress ?? "—"} | Result: ${l.result}${l.result === "failure" ? " ⚠ FAILED" : ""}`,
      ),
    ];
    downloadFile("audit_logs.txt", lines.join("\n"), "text/plain");
    toast.success(`Exported ${filtered.length} log entries`);
  };

  const clearFilters = () => {
    setSearch("");
    setFilterAction("All");
    setFilterDate("All Time");
    setShowSuspicious(false);
  };

  const hasFilters = !!search || filterAction !== "All" || filterDate !== "All Time" || showSuspicious;
  const loading = logsQuery.isLoading;
  const errored = logsQuery.error as Error | null;

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <h2 style={{ margin: 0, color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>Audit Logs</h2>
            {readOnly && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 10px", background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "20px" }}>
                <Eye size={11} color="#3b82f6" />
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#3b82f6", fontFamily: "'Poppins', sans-serif" }}>Read Only</span>
              </div>
            )}
            {department && (
              <div style={{ display: "flex", alignItems: "center", gap: "5px", padding: "3px 10px", background: "#fef9ec", border: "1px solid #fde68a", borderRadius: "20px" }}>
                <Lock size={11} color="#d97706" />
                <span style={{ fontSize: "11px", fontWeight: 600, color: "#d97706", fontFamily: "'Poppins', sans-serif" }}>{department} only</span>
              </div>
            )}
          </div>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Loader size="sm" />
              <span className="loader-text-pulse" style={{ color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif", letterSpacing: "0.2px" }}>
                Loading audit logs…
              </span>
            </div>
          ) : (
            <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
              {`Showing ${filtered.length} of ${allLogs.length} entries`}
              {logsQuery.isFetching ? " · refreshing…" : ""}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button onClick={handleExportText} disabled={readOnly}
            style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", background: readOnly ? "#f4f5f7" : "white", border: "1.5px solid #eef0f4", borderRadius: "10px", fontSize: "13px", color: readOnly ? "#9ca3af" : "#374151", cursor: readOnly ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500, opacity: readOnly ? 0.6 : 1 }}>
            <FileText size={14} /> Export TXT
          </button>
          <button onClick={handleExportCSV} disabled={readOnly}
            style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", background: readOnly ? "#f4f5f7" : "white", border: "1.5px solid #eef0f4", borderRadius: "10px", fontSize: "13px", color: readOnly ? "#9ca3af" : "#374151", cursor: readOnly ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500, opacity: readOnly ? 0.6 : 1 }}>
            <Table size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Read-only notice for admin */}
      {readOnly && (
        <div style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "12px", padding: "12px 16px", marginBottom: "18px", display: "flex", alignItems: "center", gap: "10px" }}>
          <Eye size={16} color="#3b82f6" />
          <span style={{ flex: 1, fontSize: "13px", color: "#1d4ed8", fontFamily: "'Poppins', sans-serif" }}>
            <strong>Read-only access.</strong> You can view your department's activity but cannot export. Contact your Super Admin for full access.
          </span>
        </div>
      )}

      {/* Failure alert (was "suspicious") */}
      {suspiciousCount > 0 && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "12px 16px", marginBottom: "18px", display: "flex", alignItems: "center", gap: "10px" }}>
          <AlertTriangle size={16} color="#ef4444" />
          <span style={{ flex: 1, fontSize: "13px", color: "#dc2626", fontFamily: "'Poppins', sans-serif" }}>
            <strong>{suspiciousCount} failed action{suspiciousCount === 1 ? "" : "s"}</strong> in the recent log. Inspect them to confirm nothing went wrong.
          </span>
          <button onClick={() => setShowSuspicious(!showSuspicious)}
            style={{ padding: "5px 12px", background: showSuspicious ? "#ef4444" : "white", border: "1px solid #ef4444", borderRadius: "8px", fontSize: "12px", color: showSuspicious ? "white" : "#ef4444", cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 600 }}>
            {showSuspicious ? "Show All" : "Show Failed Only"}
          </button>
        </div>
      )}

      {errored && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "12px", padding: "12px 16px", marginBottom: "18px", color: "#dc2626", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
          Failed to load audit logs: {errored.message}
        </div>
      )}

      {/* Filters */}
      <div style={{ background: "white", borderRadius: "14px", padding: "14px 18px", border: "1px solid #eef0f4", marginBottom: "18px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: "200px" }}>
          <Search size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search user, action, resource, or IP..."
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 14px 9px 36px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", outline: "none", fontFamily: "'Poppins', sans-serif" }}
            onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#f0f0f0")} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Filter size={14} color="#9ca3af" />
          <div style={{ position: "relative", display: "inline-block" }}>
            <select value={filterAction}
              onChange={(e) => { setFilterAction(e.target.value); setActionOpen(false); }}
              onMouseDown={() => setActionOpen((prev) => !prev)}
              onBlur={() => setActionOpen(false)}
              onKeyDown={(e) => { if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") setActionOpen(true); if (e.key === "Escape" || e.key === "Tab") setActionOpen(false); }}
              style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", padding: "8px 36px 8px 12px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", color: "#374151", outline: "none", fontFamily: "'Poppins', sans-serif", cursor: "pointer" }}>
              <option value="All">All actions</option>
              {allActionCodes.map((code) => (
                <option key={code} value={code}>{actionLabel(code)}</option>
              ))}
            </select>
            {actionOpen
              ? <ChevronUp size={16} color="#6b7280" style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              : <ChevronDown size={16} color="#6b7280" style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />}
          </div>
          <div style={{ position: "relative", display: "inline-block" }}>
            <select value={filterDate}
              onChange={(e) => { setFilterDate(e.target.value); setDateOpen(false); }}
              onMouseDown={() => setDateOpen((prev) => !prev)}
              onBlur={() => setDateOpen(false)}
              onKeyDown={(e) => { if (e.key === " " || e.key === "Enter" || e.key === "ArrowDown" || e.key === "ArrowUp") setDateOpen(true); if (e.key === "Escape" || e.key === "Tab") setDateOpen(false); }}
              style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", padding: "8px 36px 8px 12px", border: "1.5px solid #f0f0f0", borderRadius: "10px", fontSize: "13px", background: "#f8f9fc", color: "#374151", outline: "none", fontFamily: "'Poppins', sans-serif", cursor: "pointer" }}>
              {["All Time", "Today", "Last 7 Days", "Last 30 Days"].map((d) => <option key={d}>{d}</option>)}
            </select>
            {dateOpen
              ? <ChevronUp size={16} color="#6b7280" style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
              : <ChevronDown size={16} color="#6b7280" style={{ position: "absolute", right: "10px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />}
          </div>
        </div>
        {hasFilters && (
          <button onClick={clearFilters}
            style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "12px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>
            <X size={12} /> Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f8f9fc", borderBottom: "1px solid #eef0f4" }}>
              {["Timestamp", "User", "Action", "Resource", "IP Address", "Result", ""].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: "10px", fontWeight: 600, color: "#6b7280", letterSpacing: "0.5px", textTransform: "uppercase", fontFamily: "'Poppins', sans-serif", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <SkeletonRows
                rows={8}
                columns={[
                  { width: "78%", height: 10 },                                       // Timestamp
                  { variant: "avatar+text", width: "65%", height: 12 },              // User
                  { variant: "pill", width: 86, height: 22 },                        // Action
                  { width: "72%", height: 12 },                                      // Resource
                  { width: "60%", height: 10 },                                      // IP Address
                  { variant: "pill", width: 64, height: 22 },                        // Result
                  { width: 18, height: 14 },                                         // chevron / spacer
                ]}
              />
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={7} style={{ padding: "40px", textAlign: "center", color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                {allLogs.length === 0 ? "No audit entries yet. They'll appear here as admins make changes." : "No log entries match your filters."}
              </td></tr>
            )}
            {!loading && pageRows.map((log, i) => {
              const suspicious = log.result === "failure";
              const color = actionColor(log.action);
              return (
                <tr key={log.id} style={{ borderBottom: i < pageRows.length - 1 ? "1px solid #f9fafb" : "none", background: suspicious ? "#fef2f208" : "transparent", cursor: "pointer" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = suspicious ? "#fef2f220" : "#fafbfd")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = suspicious ? "#fef2f208" : "transparent")}
                  onClick={() => setDetailLog(log)}>
                  <td style={{ padding: "12px 16px", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <Clock size={11} color="#9ca3af" />
                      <span style={{ fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif" }}>{formatTs(log.timestamp)}</span>
                      {suspicious && <AlertTriangle size={11} color="#ef4444" />}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>{log.actorName}</div>
                    <div style={{ fontSize: "10px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
                      {log.actorRole ? (ROLE_LABEL[log.actorRole] ?? log.actorRole) : "—"}
                      {log.actorDepartment ? ` · ${log.actorDepartment}` : ""}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", background: `color-mix(in srgb, ${color} 12%, transparent)`, color, whiteSpace: "nowrap" }}>
                      {actionLabel(log.action)}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: "12px", color: "#374151", fontFamily: "'Poppins', sans-serif", background: "#f4f5f7", padding: "2px 8px", borderRadius: "6px" }}>{resourceLabel(log)}</span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                      <Globe size={11} color={suspicious ? "#ef4444" : "#9ca3af"} />
                      <span style={{ fontSize: "11px", color: suspicious ? "#ef4444" : "#6b7280", fontFamily: "'Poppins', sans-serif", fontWeight: suspicious ? 600 : 400 }}>{log.ipAddress ?? "—"}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ fontSize: "11px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", color: suspicious ? "#ef4444" : "#22c55e" }}>
                      {suspicious ? "Failed" : "Success"}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {!readOnly && <Download size={13} color="#9ca3af" />}
                    {readOnly && <Eye size={13} color="#9ca3af" />}
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
            itemLabel="entries"
          />
        )}
      </div>

      {/* Detail modal */}
      {detailLog && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, backdropFilter: "blur(4px)" }} onClick={() => setDetailLog(null)}>
          <div style={{ background: "white", borderRadius: "20px", padding: "28px", width: "480px", maxWidth: "95vw", boxShadow: "0 24px 80px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ padding: "4px 12px", borderRadius: "8px", fontSize: "12px", fontWeight: 600, background: `color-mix(in srgb, ${actionColor(detailLog.action)} 12%, transparent)`, color: actionColor(detailLog.action), fontFamily: "'Poppins', sans-serif" }}>
                  {actionLabel(detailLog.action)}
                </span>
                {detailLog.result === "failure" && <span style={{ padding: "4px 10px", borderRadius: "8px", fontSize: "11px", fontWeight: 600, background: "#fef2f2", color: "#ef4444", fontFamily: "'Poppins', sans-serif" }}>⚠ Failed</span>}
              </div>
              <button onClick={() => setDetailLog(null)} style={{ background: "#f4f5f7", border: "none", borderRadius: "8px", width: "30px", height: "30px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={15} color="#6b7280" /></button>
            </div>

            {[
              ["User", detailLog.actorName],
              ["Role", detailLog.actorRole ? (ROLE_LABEL[detailLog.actorRole] ?? detailLog.actorRole) : "—"],
              ["Department", detailLog.actorDepartment ?? "—"],
              ["Timestamp", formatTs(detailLog.timestamp)],
              ["Action code", detailLog.action],
              ["Resource", resourceLabel(detailLog)],
              ["Resource type", detailLog.resourceType ?? "—"],
              ["Resource ID", detailLog.resourceId ?? "—"],
              ["IP address", detailLog.ipAddress ?? "—"],
              ["Result", detailLog.result],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: "16px", padding: "10px 0", borderBottom: "1px solid #f9fafb" }}>
                <span style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", flexShrink: 0 }}>{label}</span>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "#374151", fontFamily: "'Poppins', sans-serif", textAlign: "right", wordBreak: "break-word" }}>{value}</span>
              </div>
            ))}

            {detailLog.details && Object.keys(detailLog.details).length > 0 && (
              <div style={{ marginTop: "14px" }}>
                <div style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", marginBottom: "6px" }}>Details</div>
                <pre style={{ margin: 0, padding: "10px 12px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "11px", color: "#374151", whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "monospace", maxHeight: "200px", overflow: "auto" }}>
                  {JSON.stringify(detailLog.details, null, 2)}
                </pre>
              </div>
            )}

            {!readOnly && (
              <button onClick={() => {
                const row = detailLog;
                const txt =
                  `Audit Log Entry\n` +
                  Object.entries({
                    User: row.actorName,
                    Role: row.actorRole,
                    Department: row.actorDepartment,
                    Timestamp: row.timestamp,
                    "Action label": actionLabel(row.action),
                    "Action code": row.action,
                    Resource: resourceLabel(row),
                    "Resource type": row.resourceType,
                    "Resource ID": row.resourceId,
                    IP: row.ipAddress,
                    Result: row.result,
                  }).map(([k, v]) => `${k}: ${v ?? "—"}`).join("\n") +
                  (row.details ? `\nDetails:\n${JSON.stringify(row.details, null, 2)}` : "");
                downloadFile(`audit_${row.id}.txt`, txt, "text/plain");
                toast.success("Log entry downloaded");
                setDetailLog(null);
              }}
                style={{ width: "100%", marginTop: "16px", padding: "11px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>
                <Download size={14} /> Download Entry
              </button>
            )}
            {readOnly && (
              <div style={{ marginTop: "16px", padding: "12px", background: "#eff6ff", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
                <Eye size={14} color="#3b82f6" />
                <span style={{ fontSize: "12px", color: "#1d4ed8", fontFamily: "'Poppins', sans-serif" }}>Read-only access — download disabled</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
