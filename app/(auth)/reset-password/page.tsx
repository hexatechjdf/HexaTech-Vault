"use client";

// /reset-password — landing page for the forgot-password email link.
//
// The Supabase magic link delivers the user here with `?code=<pkce>` in the
// query string. We show a "Set new password" form. On submit we hand both the
// code and the new password to the server action, which exchanges the code,
// updates the password, signs the user back out, and tells us to redirect.
//
// Styling deliberately mirrors LoginPage's right-card chrome so the post-email
// experience feels seamless. We don't reuse LoginPage itself because its
// content branches across "login / forgot / forgot-sent" — keeping this page
// standalone is simpler and removes the risk of cross-flow regressions.

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Lock, Check } from "lucide-react";
import { toast } from "sonner";
import { resetPasswordAction } from "./actions";

function ResetInner() {
  const params = useSearchParams();
  const router = useRouter();

  const code = params.get("code") ?? "";
  const error = params.get("error") ?? "";
  const errorDescription = params.get("error_description") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Supabase appends ?error=<code>&error_description=... when the link is
  // expired/invalid before it even gets the chance to issue a code. Surface
  // that immediately rather than wait for the user to click submit.
  useEffect(() => {
    if (error) {
      toast.error(errorDescription || "This reset link is invalid or has expired.");
    }
  }, [error, errorDescription]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || !confirm) return toast.error("Please fill in both password fields.");
    if (password.length < 8) return toast.error("Password must be at least 8 characters.");
    if (password !== confirm) return toast.error("Passwords do not match.");

    setSubmitting(true);
    const result = await resetPasswordAction(code, password);
    setSubmitting(false);

    if (result.error) {
      toast.error(result.error);
      return;
    }
    if (result.ok) {
      setDone(true);
      toast.success("Password updated. Please sign in with your new password.");
      // Brief pause so the toast lands before the navigation.
      setTimeout(() => router.replace("/login"), 1200);
    }
  };

  const showForm = !!code && !error && !done;

  return (
    <div style={{ minHeight: "100vh", background: "#0e1c35", fontFamily: "'Poppins', sans-serif", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 24px" }}>
      <div style={{ width: "100%", maxWidth: "440px", background: "white", borderRadius: "20px", padding: "36px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <h1 style={{ margin: "0 0 6px", color: "var(--brand-primary)", fontSize: "22px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>
          {done ? "Password updated" : "Set a new password"}
        </h1>
        <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: "13px", fontFamily: "'Poppins', sans-serif", lineHeight: 1.5 }}>
          {done
            ? "Redirecting you to sign in…"
            : showForm
              ? "Choose a strong password. You'll be signed out and asked to sign back in with it."
              : "This reset link is invalid or has expired. Request a new one from the login page."}
        </p>

        {showForm && (
          <form onSubmit={handleSubmit} noValidate>
            <div style={{ marginBottom: "14px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                New password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={14} color="#9ca3af" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type={showPass ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  style={{ width: "100%", boxSizing: "border-box", padding: "12px 44px 12px 40px", border: "1.5px solid #e5e7eb", borderRadius: "12px", fontSize: "14px", outline: "none", fontFamily: "'Poppins', sans-serif", color: "#1f2937", background: "#f9fafb" }}
                />
                <button type="button" onClick={() => setShowPass((v) => !v)}
                  style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px", color: "#9ca3af", display: "flex", alignItems: "center" }}>
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#374151", marginBottom: "6px" }}>
                Confirm new password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={14} color="#9ca3af" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
                <input
                  type={showPass ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your new password"
                  autoComplete="new-password"
                  style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px 12px 40px", border: "1.5px solid #e5e7eb", borderRadius: "12px", fontSize: "14px", outline: "none", fontFamily: "'Poppins', sans-serif", color: "#1f2937", background: "#f9fafb" }}
                />
              </div>
            </div>

            <button type="submit" disabled={submitting}
              style={{ width: "100%", padding: "14px", background: submitting ? "#9ca3af" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 600, cursor: submitting ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 16px rgba(27,42,74,0.35)" }}>
              {submitting ? "Updating…" : "Update password"}
            </button>
          </form>
        )}

        {(!showForm && !done) && (
          <button onClick={() => router.replace("/login")}
            style={{ width: "100%", padding: "12px", background: "white", border: "1.5px solid #e5e7eb", color: "var(--brand-primary)", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
            Back to login
          </button>
        )}

        {done && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", color: "#22c55e", fontSize: "13px", fontWeight: 500 }}>
            <Check size={16} /> Done — taking you to the login page
          </div>
        )}
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ResetInner />
    </Suspense>
  );
}
