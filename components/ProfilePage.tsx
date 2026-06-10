"use client";

// Profile page — available to every authenticated role.
//
// What the user can change here:
//   1) Display name
//   2) Google Drive email (separate from the login email, used by Drive sharing)
//   3) Password (current + new + confirm)
//
// What they can NOT change here: their role, department, status. Those are
// admin-only operations (super_admin via /api/admin/users).
//
// The Drive-email field is the bridge between the app and Google Drive:
// permissions-set reads this column when granting access to a user. If it's
// null, Drive will be asked to share against the login email instead - which
// is almost always wrong for company addresses.

import { useEffect, useState } from "react";
import { Mail, Lock, ShieldCheck, Save, KeyRound, AlertCircle, Cloud } from "lucide-react";
import { toast } from "sonner";
import { useChangePassword, useMyProfile, useUpdateProfile } from "@/lib/queries/profile";
import { useDriveStatus } from "@/lib/queries/drive";
import { Skeleton } from "@/components/Loader";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  team_lead: "Team Lead",
  lead_dev: "Lead Dev",
  team_member: "Team Member",
};

const card: React.CSSProperties = {
  background: "white",
  borderRadius: "16px",
  border: "1px solid #eef0f4",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  padding: "24px",
  marginBottom: "18px",
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: "#374151",
  marginBottom: "6px",
  fontFamily: "'Poppins', sans-serif",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px 10px 36px",
  border: "1.5px solid #e5e7eb",
  borderRadius: "10px",
  fontSize: "13px",
  outline: "none",
  fontFamily: "'Poppins', sans-serif",
  color: "#1f2937",
  background: "#f9fafb",
};

const primaryButton: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "7px",
  padding: "10px 18px",
  background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))",
  color: "white",
  border: "none",
  borderRadius: "10px",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "'Poppins', sans-serif",
};

export function ProfilePage() {
  const profileQ = useMyProfile();
  const updateProfile = useUpdateProfile();
  const changePassword = useChangePassword();

  const me = profileQ.data;

  // Identity / Drive fields
  const [name, setName] = useState("");
  const [googleEmail, setGoogleEmail] = useState("");

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Hydrate local state once the query lands.
  useEffect(() => {
    if (!me) return;
    setName(me.name);
    setGoogleEmail(me.googleEmail ?? "");
  }, [me]);

  const driveBusy = updateProfile.isPending;
  const pwBusy = changePassword.isPending;
  const isSuperAdmin = me?.role === "super_admin";

  // Super admins don't enter a separate Drive email - their OAuth-connected
  // Google account owns the whole company Drive, so we surface drive_connection
  // info as a read-only card instead.
  const driveStatus = useDriveStatus();

  async function handleSaveIdentity() {
    if (!name.trim()) return toast.error("Name is required");
    try {
      // Only send googleEmail for non-super-admins; for super_admin the
      // connected account is the source of truth.
      const payload = isSuperAdmin
        ? { name: name.trim() }
        : { name: name.trim(), googleEmail: googleEmail.trim() === "" ? null : googleEmail.trim() };
      await updateProfile.mutateAsync(payload);
      toast.success("Profile updated");
    } catch (e) {
      toast.error((e as Error).message || "Failed to update profile");
    }
  }

  async function handleChangePassword() {
    if (!currentPassword) return toast.error("Enter your current password");
    if (newPassword.length < 8) return toast.error("New password must be at least 8 characters");
    if (newPassword !== confirmPassword) return toast.error("New password and confirmation do not match");
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      toast.success("Password updated. Use your new password next time you sign in.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (e) {
      toast.error((e as Error).message || "Failed to update password");
    }
  }

  if (profileQ.isLoading) {
    // Skeleton mockup that mirrors the real page shape (Identity card + Password
    // card) so the layout doesn't jump when data lands. Same Skeleton primitive
    // used by the dashboards and the Settings → Backup runs table.
    return (
      <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif", maxWidth: "780px" }}>
        {/* Header */}
        <div style={{ marginBottom: "24px" }}>
          <Skeleton width={150} height={22} rounded="md" style={{ marginBottom: "8px" }} />
          <Skeleton width={340} height={11} rounded="md" />
        </div>

        {/* Identity card */}
        <div style={card}>
          <Skeleton width={90} height={17} rounded="md" style={{ marginBottom: "18px" }} />

          {/* Display name */}
          <div style={{ marginBottom: "16px" }}>
            <Skeleton width={92} height={11} rounded="md" style={{ marginBottom: "8px" }} />
            <Skeleton width="100%" height={40} rounded="lg" />
          </div>

          {/* Login email */}
          <div style={{ marginBottom: "16px" }}>
            <Skeleton width={80} height={11} rounded="md" style={{ marginBottom: "8px" }} />
            <Skeleton width="100%" height={40} rounded="lg" />
            <div style={{ marginTop: "8px" }}>
              <Skeleton width={260} height={10} rounded="md" />
            </div>
          </div>

          {/* Google Drive email / connection */}
          <div style={{ marginBottom: "16px" }}>
            <Skeleton width={140} height={11} rounded="md" style={{ marginBottom: "8px" }} />
            <Skeleton width="100%" height={40} rounded="lg" />
            <div style={{ marginTop: "8px" }}>
              <Skeleton width={300} height={10} rounded="md" />
            </div>
          </div>

          {/* Role + Department grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "20px" }}>
            <div>
              <Skeleton width={40} height={11} rounded="md" style={{ marginBottom: "8px" }} />
              <Skeleton width="100%" height={40} rounded="lg" />
            </div>
            <div>
              <Skeleton width={80} height={11} rounded="md" style={{ marginBottom: "8px" }} />
              <Skeleton width="100%" height={40} rounded="lg" />
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Skeleton width={140} height={38} rounded="lg" />
          </div>
        </div>

        {/* Password card */}
        <div style={card}>
          <Skeleton width={140} height={17} rounded="md" style={{ marginBottom: "18px" }} />
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ marginBottom: "14px" }}>
              <Skeleton width={130} height={11} rounded="md" style={{ marginBottom: "8px" }} />
              <Skeleton width="100%" height={40} rounded="lg" />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
            <Skeleton width={170} height={38} rounded="lg" />
          </div>
        </div>
      </div>
    );
  }
  if (profileQ.error || !me) {
    return (
      <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif" }}>
        <p style={{ color: "#dc2626", fontSize: "13px" }}>{(profileQ.error as Error)?.message ?? "Failed to load profile"}</p>
      </div>
    );
  }

  const missingDriveEmail = !me.googleEmail;
  const roleDisplay = ROLE_LABEL[me.role] ?? me.role;

  return (
    <div style={{ padding: "28px 32px", fontFamily: "'Poppins', sans-serif", maxWidth: "780px" }}>
      {/* Header */}
      <div style={{ marginBottom: "24px" }}>
        <h2 style={{ margin: "0 0 4px", color: "var(--brand-primary)", fontSize: "20px", fontWeight: 700 }}>
          My Profile
        </h2>
        <p style={{ margin: 0, color: "#9ca3af", fontSize: "13px" }}>
          Manage your display name, Drive sharing email, and password.
        </p>
      </div>

      {/* Identity card */}
      <div style={card}>
        {!isSuperAdmin && missingDriveEmail && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "12px 14px", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: "10px", marginBottom: "16px" }}>
            <AlertCircle size={16} color="#f59e0b" style={{ flexShrink: 0, marginTop: "1px" }} />
            <span style={{ fontSize: "12.5px", color: "#b45309", lineHeight: 1.5 }}>
              You haven&apos;t set a <strong>Google Drive email</strong> yet. Until you do, admins can&apos;t grant you access to folders that live in the company Drive. Set it below — a real Gmail or Workspace address.
            </span>
          </div>
        )}

        <h3 style={{ margin: "0 0 16px", color: "var(--brand-primary)", fontSize: "15px", fontWeight: 700 }}>Identity</h3>

        <div style={{ marginBottom: "16px" }}>
          <label style={label}>Display name</label>
          <div style={{ position: "relative" }}>
            <ShieldCheck size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} disabled={driveBusy} placeholder="Your name" />
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={label}>Login email</label>
          <div style={{ position: "relative" }}>
            <Mail size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input value={me.email} readOnly style={{ ...inputStyle, cursor: "not-allowed", color: "#6b7280" }} />
          </div>
          <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af" }}>
            You sign in with this address. Only a Super Admin can change it.
          </p>
        </div>

        {isSuperAdmin ? (
          // Super admin: their connected Google account IS the Drive owner.
          // No separate field; surface the connected account read-only and
          // point them to Settings if they want to change accounts.
          <div style={{ marginBottom: "16px" }}>
            <label style={label}>Google Drive connection</label>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px", background: "color-mix(in srgb, var(--brand-primary) 4%, transparent)", border: "1px solid color-mix(in srgb, var(--brand-primary) 12%, transparent)", borderRadius: "10px" }}>
              <Cloud size={16} color="var(--brand-primary)" style={{ flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--brand-primary)", fontFamily: "'Poppins', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {driveStatus.isLoading
                    ? "Loading…"
                    : driveStatus.data?.connected
                      ? driveStatus.data.accountEmail ?? "Connected"
                      : "Not connected"}
                </div>
                <div style={{ fontSize: "11px", color: "#6b7280", fontFamily: "'Poppins', sans-serif", marginTop: "2px", lineHeight: 1.4 }}>
                  {driveStatus.data?.connected
                    ? "This Google account owns the company root folder. To change it, open Settings → Google Drive → Change Drive Account."
                    : "Connect a Google account in Settings → Google Drive to enable Drive sharing."}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: "16px" }}>
            <label style={label}>Google Drive email</label>
            <div style={{ position: "relative" }}>
              <Mail size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
              <input
                value={googleEmail}
                onChange={(e) => setGoogleEmail(e.target.value)}
                type="email"
                placeholder="your.address@gmail.com"
                style={inputStyle}
                disabled={driveBusy}
              />
            </div>
            <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#9ca3af", lineHeight: 1.5 }}>
              Drive shares folders to this address. It can be the same as your login email if that&apos;s already a Google account; otherwise enter your Gmail or Workspace email. Leave blank to clear.
            </p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" }}>
          <div>
            <label style={label}>Role</label>
            <div style={{ padding: "10px 12px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "13px", color: "#374151", fontWeight: 500 }}>
              {roleDisplay}
            </div>
          </div>
          <div>
            <label style={label}>Department</label>
            <div style={{ padding: "10px 12px", background: "#f8f9fc", border: "1px solid #eef0f4", borderRadius: "10px", fontSize: "13px", color: "#374151", fontWeight: 500 }}>
              {me.departmentName || "—"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={handleSaveIdentity} disabled={driveBusy} style={{ ...primaryButton, opacity: driveBusy ? 0.6 : 1, cursor: driveBusy ? "not-allowed" : "pointer" }}>
            <Save size={14} /> {driveBusy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {/* Password card */}
      <div style={card}>
        <h3 style={{ margin: "0 0 16px", color: "var(--brand-primary)", fontSize: "15px", fontWeight: 700 }}>Change password</h3>

        <div style={{ marginBottom: "14px" }}>
          <label style={label}>Current password</label>
          <div style={{ position: "relative" }}>
            <Lock size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} type="password" placeholder="Enter your current password" style={inputStyle} disabled={pwBusy} />
          </div>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <label style={label}>New password</label>
          <div style={{ position: "relative" }}>
            <KeyRound size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input value={newPassword} onChange={(e) => setNewPassword(e.target.value)} type="password" placeholder="Minimum 8 characters" style={inputStyle} disabled={pwBusy} />
          </div>
        </div>

        <div style={{ marginBottom: "16px" }}>
          <label style={label}>Confirm new password</label>
          <div style={{ position: "relative" }}>
            <KeyRound size={14} color="#9ca3af" style={{ position: "absolute", left: "12px", top: "50%", transform: "translateY(-50%)" }} />
            <input value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} type="password" placeholder="Re-enter the new password" style={inputStyle} disabled={pwBusy} />
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button onClick={handleChangePassword} disabled={pwBusy} style={{ ...primaryButton, opacity: pwBusy ? 0.6 : 1, cursor: pwBusy ? "not-allowed" : "pointer" }}>
            <KeyRound size={14} /> {pwBusy ? "Updating…" : "Update password"}
          </button>
        </div>
      </div>
    </div>
  );
}
