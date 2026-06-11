"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Building, Mail, Cloud, Database, Save, Check, AlertCircle, CheckCircle, Upload, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { COMPANY_ROOT_NAME } from "@/lib/config";
import { useBranding, useUpdateBranding, useUploadLogo } from "@/lib/queries/branding";
import { useCanAct } from "@/lib/queries/tab-permissions";
import { useDriveStatus, useStartDriveConnect, useVerifyDrive } from "@/lib/queries/drive";
import {
  useBackupConfig,
  useBackupRuns,
  useRunBackupNow,
  useUpdateBackupConfig,
  useBackupDownloadUrl,
  type BackupFrequency,
} from "@/lib/queries/backup";
import { Pagination } from "@/components/Pagination";

const logoBlack = "/imports/HTS_Logo.png";

const sections = [
  { id: "company", label: "Company Info", icon: Building },
  { id: "email", label: "Email Notifications", icon: Mail },
  { id: "api", label: "Google Drive", icon: Cloud },
  { id: "backup", label: "Backup Settings", icon: Database },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div onClick={() => onChange(!checked)} style={{ width: "44px", height: "24px", borderRadius: "100px", background: checked ? "var(--brand-primary)" : "#d1d5db", cursor: "pointer", position: "relative", transition: "background 0.2s", flexShrink: 0 }}>
      <div style={{ position: "absolute", top: "3px", left: checked ? "23px" : "3px", width: "18px", height: "18px", borderRadius: "50%", background: "white", boxShadow: "0 1px 4px rgba(0,0,0,0.2)", transition: "left 0.2s" }} />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "18px" }}>
      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "8px", fontFamily: "'Poppins', sans-serif" }}>{label}</label>
      {children}
    </div>
  );
}

const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 14px", border: "1.5px solid #e5e7eb", borderRadius: "10px", fontSize: "13px", color: "#1f2937", background: "#f9fafb", outline: "none", fontFamily: "'Poppins', sans-serif" };

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Backup panel.
//
// Live state lives in backup_config (singleton table). The pg_cron daily
// schedule plus the backup-run Edge Function pull from the same row, so
// any change here propagates everywhere. UX:
//   - Enabled toggle:    saves immediately on change.
//   - Frequency select:  saves immediately on change (matching the toggle).
//   - Retention number:  edited locally, persisted on its own Save button so
//                        an in-flight typing pass doesn't ping the server.
//   - "Run Manual Backup Now": fires POST /api/admin/backup/run; refreshes
//                        the runs list on success.
//   - Recent backups:    shows the last N rows from backup_runs with a
//                        signed-URL download link per success row.
// ─────────────────────────────────────────────────────────────────────────────
function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatRunTime(iso: string | null): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const FREQUENCY_LABEL: Record<BackupFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly (Sundays)",
  monthly: "Monthly (1st of month)",
};

const BACKUP_RUNS_PAGE_SIZE = 10;

function BackupSettingsPanel() {
  const configQuery = useBackupConfig();
  const updateConfig = useUpdateBackupConfig();
  const runNow = useRunBackupNow();
  // Fetch the BFF's max so a single round-trip covers the whole displayable
  // history (retention caps growth, so 100 is more than enough in practice).
  const runsQuery = useBackupRuns(100);
  const download = useBackupDownloadUrl();

  // 1-based page index for the Recent Backups table. Pagination is only shown
  // when total > BACKUP_RUNS_PAGE_SIZE; on smaller datasets we just render
  // every row and the controls stay hidden.
  const [runsPage, setRunsPage] = useState(1);
  const allRuns = runsQuery.data ?? [];
  const showPagination = allRuns.length > BACKUP_RUNS_PAGE_SIZE;
  const pagedRuns = showPagination
    ? allRuns.slice((runsPage - 1) * BACKUP_RUNS_PAGE_SIZE, runsPage * BACKUP_RUNS_PAGE_SIZE)
    : allRuns;
  // If the dataset shrinks (retention purge / manual delete in DB), keep the
  // current page in range.
  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(allRuns.length / BACKUP_RUNS_PAGE_SIZE));
    if (runsPage > maxPage) setRunsPage(maxPage);
  }, [allRuns.length, runsPage]);

  // Mirror the persisted retention into a local input so typing doesn't
  // ping the server. Server-write happens on the dedicated Save button.
  const persistedRetention = configQuery.data?.retentionDays ?? 30;
  const [retentionDraft, setRetentionDraft] = useState<string>(String(persistedRetention));
  useEffect(() => {
    setRetentionDraft(String(persistedRetention));
  }, [persistedRetention]);

  const cfg = configQuery.data;
  const cfgLoading = configQuery.isLoading;
  const cfgError = configQuery.error as Error | null;

  async function handleToggle(next: boolean) {
    try {
      await updateConfig.mutateAsync({ enabled: next });
      toast.success(next ? "Automatic backups enabled" : "Automatic backups disabled");
    } catch (e) {
      toast.error((e as Error).message || "Could not update setting");
    }
  }

  async function handleFrequencyChange(next: BackupFrequency) {
    try {
      await updateConfig.mutateAsync({ frequency: next });
      toast.success(`Backup frequency set to ${FREQUENCY_LABEL[next]}`);
    } catch (e) {
      toast.error((e as Error).message || "Could not update frequency");
    }
  }

  async function handleSaveRetention() {
    const n = Number(retentionDraft);
    if (!Number.isInteger(n) || n < 1 || n > 365) {
      toast.error("Retention must be an integer between 1 and 365");
      return;
    }
    if (n === persistedRetention) return;
    try {
      await updateConfig.mutateAsync({ retentionDays: n });
      toast.success(`Retention set to ${n} days`);
    } catch (e) {
      toast.error((e as Error).message || "Could not update retention");
    }
  }

  async function handleRunNow() {
    try {
      const result = await runNow.mutateAsync();
      if (result.skipped) {
        toast.info(result.reason || "Backup skipped");
      } else if (result.ok) {
        toast.success(`Backup created (${formatBytes(result.bytes ?? null)})`);
      } else {
        toast.error(result.error || "Backup failed");
      }
    } catch (e) {
      toast.error((e as Error).message || "Failed to start backup");
    }
  }

  async function handleDownload(runId: string) {
    try {
      const url = await download.mutateAsync(runId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message || "Could not start download");
    }
  }

  if (cfgError) {
    return (
      <div style={{ padding: "16px", background: "#fef2f2", borderRadius: "12px", border: "1px solid #fecaca", color: "#dc2626", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
        {cfgError.message}
      </div>
    );
  }

  return (
    <div>
      {/* Enabled toggle */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0 20px", borderBottom: "1px solid #f4f5f7", marginBottom: "20px" }}>
        <div>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>Automatic Backups</div>
          <div style={{ fontSize: "12px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
            Snapshots Postgres (users, folders, files, permissions, branding) to private storage. Drive bytes are not re-archived.
          </div>
        </div>
        <Toggle
          checked={cfg?.enabled ?? false}
          onChange={(v) => { if (!cfgLoading && !updateConfig.isPending) void handleToggle(v); }}
        />
      </div>

      {/* Frequency */}
      <Field label="Backup Frequency">
        <select
          value={cfg?.frequency ?? "daily"}
          disabled={cfgLoading || updateConfig.isPending}
          onChange={(e) => void handleFrequencyChange(e.target.value as BackupFrequency)}
          style={{ ...inp, cursor: "pointer", background: "white" }}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly (Sundays)</option>
          <option value="monthly">Monthly (1st of month)</option>
        </select>
        <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af" }}>
          Cron runs every day at 03:00 UTC; the function executes only when the chosen cadence matches.
        </p>
      </Field>

      {/* Retention */}
      <Field label="Retention Period (days)">
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="number"
            value={retentionDraft}
            onChange={(e) => setRetentionDraft(e.target.value)}
            disabled={cfgLoading}
            min={1}
            max={365}
            style={{ ...inp, flex: 1 }}
            onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")}
            onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
          />
          <button
            onClick={handleSaveRetention}
            disabled={cfgLoading || updateConfig.isPending || retentionDraft === String(persistedRetention)}
            style={{ padding: "10px 16px", background: "var(--brand-primary)", color: "white", border: "none", borderRadius: "10px", cursor: "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", opacity: (cfgLoading || updateConfig.isPending || retentionDraft === String(persistedRetention)) ? 0.5 : 1 }}
          >
            Save
          </button>
        </div>
        <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af" }}>
          Successful backups older than this many days are purged from the bucket on the next run.
        </p>
      </Field>

      {/* Manual run */}
      <div style={{ display: "flex", gap: "8px", margin: "20px 0 24px" }}>
        <button
          onClick={handleRunNow}
          disabled={runNow.isPending || !(cfg?.enabled)}
          style={{ display: "flex", alignItems: "center", gap: "7px", padding: "10px 18px", background: "#f8f9fc", border: "1.5px solid #e5e7eb", borderRadius: "10px", cursor: (runNow.isPending || !(cfg?.enabled)) ? "not-allowed" : "pointer", fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif", fontWeight: 500, opacity: (runNow.isPending || !(cfg?.enabled)) ? 0.6 : 1 }}
          title={!(cfg?.enabled) ? "Enable automatic backups first" : ""}
        >
          <RefreshCw size={14} />
          {runNow.isPending ? "Running…" : "Run Manual Backup Now"}
        </button>
      </div>

      {/* Recent runs */}
      <div style={{ marginTop: "16px" }}>
        <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "10px", fontFamily: "'Poppins', sans-serif" }}>
          Recent Backups
        </div>
        {runsQuery.isLoading && (
          <div style={{ color: "#9ca3af", fontSize: "12px" }}>Loading…</div>
        )}
        {!runsQuery.isLoading && allRuns.length === 0 && (
          <div style={{ padding: "14px 16px", borderRadius: "10px", border: "1px dashed #e5e7eb", color: "#9ca3af", fontSize: "12px", textAlign: "center" }}>
            No backups yet. The first one runs at the next scheduled tick, or click &quot;Run Manual Backup Now&quot;.
          </div>
        )}
        {!runsQuery.isLoading && allRuns.length > 0 && (
          <div style={{ border: "1px solid #eef0f4", borderRadius: "12px", overflow: "hidden" }}>
            {pagedRuns.map((r, i) => {
              const statusColor =
                r.status === "success" ? "#22c55e" :
                r.status === "failed" ? "#ef4444" :
                "#f59e0b";
              const isLast = i === pagedRuns.length - 1;
              return (
                <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderBottom: isLast ? "none" : "1px solid #f4f5f7", background: i % 2 === 0 ? "white" : "#fafbfc" }}>
                  <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12.5px", fontWeight: 500, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif" }}>
                      {formatRunTime(r.startedAt)}
                      <span style={{ color: "#9ca3af", marginLeft: "8px", fontWeight: 400 }}>
                        ({r.triggeredBy})
                      </span>
                    </div>
                    {r.status === "failed" && r.error && (
                      <div style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.error}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: "11.5px", color: "#6b7280", flexShrink: 0, minWidth: "60px", textAlign: "right" }}>
                    {formatBytes(r.bytes)}
                  </div>
                  <div style={{ fontSize: "11px", fontWeight: 600, color: statusColor, textTransform: "uppercase", letterSpacing: "0.4px", flexShrink: 0, minWidth: "62px", textAlign: "right" }}>
                    {r.status}
                  </div>
                  {r.status === "success" && (
                    <button
                      onClick={() => handleDownload(r.id)}
                      disabled={download.isPending}
                      style={{ padding: "5px 10px", background: "white", border: "1.5px solid #e5e7eb", borderRadius: "8px", fontSize: "11.5px", color: "#374151", cursor: download.isPending ? "wait" : "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500 }}
                    >
                      Download
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {!runsQuery.isLoading && showPagination && (
          <div style={{ marginTop: "12px" }}>
            <Pagination
              page={runsPage}
              pageSize={BACKUP_RUNS_PAGE_SIZE}
              total={allRuns.length}
              onPageChange={setRunsPage}
              hidePageSizeSelector
              itemLabel="backups"
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Settings → Google Drive panel.
 *
 * Wired to React Query hooks against the BFF (/api/admin/drive/*). The actual
 * Drive logic and Google credentials live in Edge Functions; the browser only
 * talks to our Next BFF.
 *
 * Behaviour:
 *   - Not connected → super_admin clicks "Connect Google Drive" → browser is
 *     redirected to Google consent → callback updates the singleton row.
 *   - Connected → panel shows account email + root folder + last sync. The
 *     "Verify connection" button pings Drive to confirm the stored token still
 *     works. "Change Drive Account" restarts the OAuth flow so the same row
 *     can be re-pointed at a different Google account (or refreshed after a
 *     test-user refresh-token expiry).
 *
 * After Google redirects back here with ?drive=<status> we surface a toast
 * and strip the query param so a manual refresh doesn't re-toast.
 */
function DriveConnectionPanel() {
  const { user } = useAuth();
  const isSuper = user?.role === "super_admin";
  const searchParams = useSearchParams();

  const statusQuery = useDriveStatus();
  const startConnect = useStartDriveConnect();
  const verify = useVerifyDrive();

  // Handle the redirect back from Google.
  useEffect(() => {
    const drive = searchParams.get("drive");
    if (!drive) return;
    if (drive === "connected") toast.success("Google Drive connected.");
    else if (drive === "already_connected") toast.info("Google Drive was already connected.");
    else if (drive === "cancelled") toast.info("Drive connection cancelled.");
    else if (drive === "no_refresh_token") toast.error("Google didn't return a refresh token. Try again with the consent screen.");
    else if (drive === "invalid_state") toast.error("Invalid OAuth state. Please try again.");
    else toast.error(`Drive connect failed (${drive}).`);
    if (typeof window !== "undefined") {
      const u = new URL(window.location.href);
      u.searchParams.delete("drive");
      window.history.replaceState({}, "", u.toString());
    }
    void statusQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const status = statusQuery.data;
  const loading = statusQuery.isLoading;

  const handleConnect = async () => {
    if (!isSuper) { toast.error("Only the Super Admin can connect Google Drive."); return; }
    try {
      const { url } = await startConnect.mutateAsync();
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message || "Failed to start the connect flow.");
    }
  };

  const handleVerify = async () => {
    try {
      const r = await verify.mutateAsync();
      if (r.ok) {
        toast.success(`Verified — connected as ${r.accountEmail ?? "—"}.`);
        return;
      }
      switch (r.reason) {
        case "not_connected":  toast.error("Not connected yet."); break;
        case "token_revoked":  toast.error("Google revoked access. Click Change Drive Account to reconnect."); break;
        case "root_missing":   toast.error("Company root folder is missing on the Drive. Reconnect or restore it."); break;
        case "drive_error":    toast.error("Drive API rejected the request. Check function logs."); break;
        default:               toast.error("Verification failed.");
      }
    } catch (e) {
      toast.error((e as Error).message || "Verification failed.");
    }
  };

  const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : "—");

  if (loading) return <div style={{ color: "#9ca3af", fontSize: "13px" }}>Loading connection status…</div>;

  const row: React.CSSProperties = { display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #f4f5f7", fontSize: "13px", fontFamily: "'Poppins', sans-serif" };
  const labelCss: React.CSSProperties = { color: "#9ca3af" };
  const valCss: React.CSSProperties = { color: "#1f2937", fontWeight: 600 };

  if (status?.connected) {
    const busy = startConnect.isPending || verify.isPending;
    return (
      <div>
        <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "16px", marginBottom: "18px", display: "flex", alignItems: "center", gap: "12px" }}>
          <CheckCircle size={20} color="#22c55e" />
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#15803d", fontFamily: "'Poppins', sans-serif" }}>Google Drive Connected</div>
            <div style={{ fontSize: "12px", color: "#16a34a", fontFamily: "'Poppins', sans-serif" }}>
              All vault activity is confined to the company root folder.
            </div>
          </div>
        </div>

        <div style={{ background: "white", border: "1px solid #eef0f4", borderRadius: "12px", padding: "4px 16px", marginBottom: "16px" }}>
          <div style={row}><span style={labelCss}>Connected account</span><span style={valCss}>{status.accountEmail ?? "—"}</span></div>
          <div style={row}><span style={labelCss}>Company root folder</span><span style={valCss}>{status.rootFolderName ?? COMPANY_ROOT_NAME}</span></div>
          <div style={row}><span style={labelCss}>Connected on</span><span style={valCss}>{fmt(status.connectedAt)}</span></div>
          <div style={{ ...row, borderBottom: "none" }}><span style={labelCss}>Last synced</span><span style={valCss}>{fmt(status.lastSyncAt)}</span></div>
        </div>

        {isSuper && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px", padding: "10px 14px", background: "color-mix(in srgb, var(--brand-primary) 5%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-primary) 15%, transparent)", borderRadius: "10px", marginBottom: "18px" }}>
            <ShieldCheck size={14} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: "1px" }} />
            <span style={{ fontSize: "12px", color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", lineHeight: 1.5 }}>
              You can <strong>switch to a different Google account</strong> at any time. Reconnecting to the same account reuses the existing company root folder, so nothing is lost.
            </span>
          </div>
        )}

        {isSuper && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", justifyContent: "flex-end" }}>
            <button onClick={handleVerify} disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", background: "white", border: "1.5px solid #e5e7eb", borderRadius: "10px", cursor: busy ? "not-allowed" : "pointer", fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif", fontWeight: 600, opacity: busy ? 0.6 : 1 }}>
              <RefreshCw size={14} /> {verify.isPending ? "Verifying…" : "Verify connection"}
            </button>
            <button onClick={handleConnect} disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 16px", background: busy ? "#9ca3af" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", cursor: busy ? "not-allowed" : "pointer", fontSize: "13px", fontWeight: 600, fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 12px rgba(0,0,0,0.15)" }}>
              <Cloud size={14} /> {startConnect.isPending ? "Redirecting…" : "Change Drive Account"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Not connected
  const busy = startConnect.isPending;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "12px", padding: "16px", marginBottom: "18px" }}>
        <AlertCircle size={20} color="#f59e0b" />
        <div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#b45309", fontFamily: "'Poppins', sans-serif" }}>Google Drive not connected</div>
          <div style={{ fontSize: "12px", color: "#d97706", fontFamily: "'Poppins', sans-serif" }}>
            Connect the company Google Drive to enable file storage and access control.
          </div>
        </div>
      </div>

      <div style={{ background: "white", border: "1px solid #eef0f4", borderRadius: "12px", padding: "18px", marginBottom: "18px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", marginBottom: "14px" }}>
          <ShieldCheck size={18} color="var(--brand-primary)" style={{ flexShrink: 0, marginTop: "1px" }} />
          <div style={{ fontSize: "12.5px", color: "#4b5563", lineHeight: 1.6, fontFamily: "'Poppins', sans-serif" }}>
            Connect once and a single company root folder named <strong>&ldquo;{COMPANY_ROOT_NAME}&rdquo;</strong> will hold everything. The system never touches anything outside it. You can change the Google account later from this same screen.
          </div>
        </div>

        {isSuper ? (
          <button onClick={handleConnect} disabled={busy}
            style={{ display: "flex", alignItems: "center", gap: "9px", padding: "12px 22px", background: busy ? "#9ca3af" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: 600, cursor: busy ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 12px rgba(0,0,0,0.2)" }}>
            <Cloud size={16} /> {busy ? "Redirecting…" : "Connect Google Drive"}
          </button>
        ) : (
          <div style={{ fontSize: "13px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>
            Only the Super Admin can connect Google Drive. Please contact your Super Admin.
          </div>
        )}
      </div>
    </div>
  );
}

export function Settings() {
  const [activeSection, setActiveSection] = useState("company");
  const [saved, setSaved] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Company — local form state (initial values overwritten by useBranding below).
  const [companyName, setCompanyName] = useState("HexaTech Solutions Pvt. Ltd.");
  const [primaryColor, setPrimaryColor] = useState("var(--brand-primary)");
  const [accentColor, setAccentColor] = useState("var(--brand-accent)");
  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  // Company / organization code appended to cloned proposal folders and the
  // master-doc file inside them. Default "JDF" matches the convention
  // requested by CRM; rename here whenever the organization rebrands.
  // Folder: "Jeff Bear - LogoQR - JDF"
  // File:   "Jeff Bear - LogoQR - JDF Proposal - Master Doc.docx"
  const [proposalLabel, setProposalLabel] = useState("JDF");

  // React Query: server source of truth for branding. Sync to local state on
  // load so the inputs are controlled but the data still streams in from the
  // BFF. The mutation hooks below do the actual persistence.
  const brandingQuery = useBranding();
  const updateBranding = useUpdateBranding();
  const uploadLogo = useUploadLogo();
  // Tab gate: this entire screen is the Settings tab. View-only users see
  // the form populated but can't hit Save (and the server still rejects
  // mutations they aren't authorised for).
  const canActSettings = useCanAct("settings");

  useEffect(() => {
    const b = brandingQuery.data;
    if (!b) return;
    setCompanyName(b.companyName);
    setPrimaryColor(b.primaryColor);
    setAccentColor(b.accentColor);
    setLogoSrc(b.logoUrl);
    setProposalLabel(b.proposalLabel);
  }, [brandingQuery.data]);

  const isSavingCompany =
    activeSection === "company" && (updateBranding.isPending || uploadLogo.isPending);

  // Email
  const [smtpEmail, setSmtpEmail] = useState("notifications@hexatech.io");
  const [notifFailedLogin, setNotifFailedLogin] = useState(true);
  const [notifBulkDownload, setNotifBulkDownload] = useState(true);
  const [notifStorageFull, setNotifStorageFull] = useState(true);
  const [notifNewUser, setNotifNewUser] = useState(true);

  // Backup state moved into <BackupSettingsPanel /> (declared below) so it
  // can own its own React Query + save UX, mirroring DriveConnectionPanel.

  const handleSave = async () => {
    // For Company Info, push real values to the BFF. Other tabs still use
    // their existing in-memory toast (not yet persisted).
    if (activeSection === "company") {
      const trimmedName = companyName.trim();
      const trimmedLabel = proposalLabel.trim();
      if (!trimmedName) { toast.error("Company name cannot be empty"); return; }
      if (!trimmedLabel) { toast.error("Proposal label cannot be empty"); return; }
      try {
        await updateBranding.mutateAsync({
          companyName: trimmedName,
          primaryColor,
          accentColor,
          proposalLabel: trimmedLabel,
        });
        setSaved(true);
        toast.success("Company info saved");
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        toast.error((e as Error).message ?? "Save failed");
      }
      return;
    }
    setSaved(true);
    toast.success("Settings saved successfully");
    setTimeout(() => setSaved(false), 3000);
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still re-fires onChange.
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Logo must be 2 MB or smaller"); return; }
    try {
      const fresh = await uploadLogo.mutateAsync(file);
      setLogoSrc(fresh.logoUrl);
      toast.success("Logo updated successfully");
    } catch (err) {
      toast.error((err as Error).message ?? "Upload failed");
    }
  };

  // (IP Whitelist handlers removed alongside the IP Whitelist section.)

  const renderSection = () => {
    switch (activeSection) {
      case "company":
        return (
          <div>
            <Field label="Company Name">
              <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} style={inp} onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <Field label="Primary Brand Color">
                <div style={{ display: "flex", gap: "8px" }}>
                  <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} style={{ width: "44px", height: "40px", padding: "2px", border: "1.5px solid #e5e7eb", borderRadius: "10px", cursor: "pointer" }} />
                  <input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} style={{ ...inp, width: "auto", flex: 1 }} onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                </div>
              </Field>
              <Field label="Accent Color">
                <div style={{ display: "flex", gap: "8px" }}>
                  <input type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ width: "44px", height: "40px", padding: "2px", border: "1.5px solid #e5e7eb", borderRadius: "10px", cursor: "pointer" }} />
                  <input value={accentColor} onChange={(e) => setAccentColor(e.target.value)} style={{ ...inp, width: "auto", flex: 1 }} onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                </div>
              </Field>
            </div>
            <Field label="Organization Code">
              <input
                value={proposalLabel}
                onChange={(e) => setProposalLabel(e.target.value)}
                style={inp}
                onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")}
                onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")}
                placeholder="e.g. JDF"
                maxLength={80}
              />
              <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif", lineHeight: 1.55 }}>
                Short code used when cloning a proposal sample. The Clone flow
                builds both the project folder and the master-doc file from this code:
                <br />
                Folder: <strong>Client &middot; Project &middot; {proposalLabel.trim() || "JDF"}</strong>
                <br />
                File: <strong>Client &middot; Project &middot; {proposalLabel.trim() || "JDF"} Proposal - Master Doc</strong>
              </p>
            </Field>
            <Field label="Company Logo">
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleLogoUpload} />
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "16px", background: "#f4f5f7", border: "2px dashed #e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
                  <img src={logoSrc ?? logoBlack} alt="Logo" style={{ width: logoSrc ? "100%" : "52px", height: logoSrc ? "100%" : "auto", objectFit: "contain" }} />
                </div>
                <div>
                  <button onClick={() => logoInputRef.current?.click()}
                    style={{ display: "flex", alignItems: "center", gap: "7px", padding: "10px 16px", border: "1.5px solid #e5e7eb", borderRadius: "10px", background: "white", cursor: "pointer", fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif", fontWeight: 500, marginBottom: "6px" }}>
                    <Upload size={14} /> Upload New Logo
                  </button>
                  <p style={{ margin: 0, fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>PNG, JPG, SVG · Max 2MB</p>
                </div>
              </div>
            </Field>
          </div>
        );

      case "email":
        return (
          <div>
            <Field label="SMTP Email for Notifications">
              <input value={smtpEmail} onChange={(e) => setSmtpEmail(e.target.value)} type="email" style={inp} onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
            </Field>
            <button onClick={() => toast.success(`Test email sent to ${smtpEmail}`)}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "9px 16px", background: "white", border: "1.5px solid #e5e7eb", borderRadius: "10px", cursor: "pointer", fontSize: "13px", color: "#374151", fontFamily: "'Poppins', sans-serif", fontWeight: 500, marginBottom: "20px" }}>
              Send Test Email
            </button>
            <div style={{ fontSize: "11px", fontWeight: 600, color: "#9ca3af", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: "12px", fontFamily: "'Poppins', sans-serif" }}>Notification Triggers</div>
            {[
              { key: "failedLogin", label: "Failed Login Attempts (3+)", sub: "Notify when 3+ failed logins from same IP", value: notifFailedLogin, set: setNotifFailedLogin },
              { key: "bulkDownload", label: "Bulk Download Alert", sub: "Notify when user downloads 5+ files at once", value: notifBulkDownload, set: setNotifBulkDownload },
              { key: "storageFull", label: "Storage 80% Full", sub: "Notify when Google Workspace storage exceeds 80%", value: notifStorageFull, set: setNotifStorageFull },
              { key: "newUser", label: "New User Added", sub: "Notify when a new account is created", value: notifNewUser, set: setNotifNewUser },
            ].map((item) => (
              <div key={item.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 0", borderBottom: "1px solid #f4f5f7" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: 500, color: "#374151", fontFamily: "'Poppins', sans-serif" }}>{item.label}</div>
                  <div style={{ fontSize: "11px", color: "#9ca3af", fontFamily: "'Poppins', sans-serif" }}>{item.sub}</div>
                </div>
                <Toggle checked={item.value} onChange={item.set} />
              </div>
            ))}
          </div>
        );

      case "api":
        return <DriveConnectionPanel />;

      case "backup":
        return <BackupSettingsPanel />;

      default:
        return null;
    }
  };

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>Settings</h2>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>Configure your HexaTech Vault instance</p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: "18px" }}>
        {/* Sidebar nav */}
        <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", padding: "10px", height: "fit-content" }}>
          {sections.map((s) => {
            const active = activeSection === s.id;
            return (
              <button key={s.id} onClick={() => setActiveSection(s.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: "9px", padding: "10px 12px", borderRadius: "10px", border: "none", borderLeft: `2px solid ${active ? "var(--brand-accent)" : "transparent"}`, background: active ? "color-mix(in srgb, var(--brand-primary) 5%, transparent)" : "transparent", cursor: "pointer", fontSize: "13px", color: active ? "var(--brand-primary)" : "#6b7280", fontWeight: active ? 600 : 400, fontFamily: "'Poppins', sans-serif", textAlign: "left", marginBottom: "2px" }}
                onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "#f8f9fc"; }}
                onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}>
                <s.icon size={15} color={active ? "var(--brand-accent)" : "#9ca3af"} />
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Content panel */}
        <div style={{ background: "white", borderRadius: "16px", border: "1px solid #eef0f4", overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #f4f5f7", display: "flex", alignItems: "center", justifyContent: "space-between", background: "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 2%, transparent), transparent)" }}>
            <div>
              <h3 style={{ margin: "0 0 2px", color: "var(--brand-primary)", fontSize: "15px", fontWeight: 600, fontFamily: "'Poppins', sans-serif" }}>{sections.find(s => s.id === activeSection)?.label}</h3>
              <p style={{ margin: 0, color: "#9ca3af", fontSize: "11px", fontFamily: "'Poppins', sans-serif" }}>Changes take effect immediately after saving</p>
            </div>
            <button onClick={handleSave} disabled={isSavingCompany || !canActSettings}
              title={!canActSettings ? "View-only access on Settings" : undefined}
              style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 18px", background: saved ? "#22c55e" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "10px", fontSize: "13px", fontWeight: 600, cursor: (isSavingCompany || !canActSettings) ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", transition: "background 0.2s", boxShadow: "0 4px 12px rgba(27,42,74,0.3)", opacity: (isSavingCompany || !canActSettings) ? 0.7 : 1 }}>
              {saved ? <Check size={14} /> : <Save size={14} />}
              {isSavingCompany ? "Saving…" : saved ? "Saved!" : "Save Changes"}
            </button>
          </div>
          <div style={{ padding: "24px" }}>{renderSection()}</div>
        </div>
      </div>
    </div>
  );
}
