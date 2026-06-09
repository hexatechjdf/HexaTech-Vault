"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, Mail, ArrowLeft, Check } from "lucide-react";
import { toast } from "sonner";
import { useBranding } from "@/lib/queries/branding";

// Fallback logo when branding hasn't loaded yet or no custom logo is set.
const FALLBACK_LOGO = "/imports/HTS_Logo.png";

interface LoginPageProps {
  /** Real auth handler — wired in app/(auth)/login/page.tsx to the
   *  Supabase signInWithPassword server action. */
  onSubmitCredentials?: (email: string, password: string) => void | Promise<void>;
}

export function LoginPage({ onSubmitCredentials }: LoginPageProps) {
  // Live branding (logo + company name). The /api/admin/branding GET is
  // intentionally public, so this works on the unauthenticated /login page.
  const { data: branding } = useBranding();
  const logoSrc = branding?.logoUrl ?? FALLBACK_LOGO;
  const companyName = branding?.companyName ?? "HexaTech Vault";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");

  // Forgot password flow
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotSent, setForgotSent] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { setError("Please fill in all fields."); return; }
    setError("");
    if (onSubmitCredentials) {
      void onSubmitCredentials(email, password);
    }
  };

  const handleForgotPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!forgotEmail) { toast.error("Please enter your email address"); return; }
    if (!forgotEmail.includes("@")) { toast.error("Please enter a valid email address"); return; }
    setForgotLoading(true);
    setTimeout(() => {
      setForgotLoading(false);
      setForgotSent(true);
      toast.success(`Password reset email sent to ${forgotEmail}`);
    }, 1200);
  };

  return (
    <div style={{ minHeight: "100vh", background: "#0e1c35", fontFamily: "'Poppins', sans-serif", position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {/* Organic background */}
      <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0.06, pointerEvents: "none" }} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="g1" cx="30%" cy="40%"><stop offset="0%" stopColor="var(--brand-accent)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
          <radialGradient id="g2" cx="80%" cy="70%"><stop offset="0%" stopColor="var(--brand-accent)" /><stop offset="100%" stopColor="transparent" /></radialGradient>
        </defs>
        <ellipse cx="200" cy="350" rx="420" ry="320" fill="url(#g1)" />
        <ellipse cx="1200" cy="600" rx="380" ry="280" fill="url(#g2)" />
        <path d="M0,400 Q200,300 400,450 T800,380 T1200,440 T1440,380 L1440,900 L0,900 Z" fill="var(--brand-accent)" opacity="0.04" />
      </svg>
      {/* Decorative dots */}
      {[{ t: "30%", r: "12%", s: "6px" }, { t: "35%", l: "10%", s: "8px" }, { b: "20%", r: "8%", s: "5px" }].map((pos, i) => (
        <div key={i} style={{ position: "absolute", ...Object.fromEntries(Object.entries(pos).filter(([k]) => k !== "s")), width: pos.s, height: pos.s, borderRadius: "50%", background: "var(--brand-accent)", opacity: 0.3 }} />
      ))}

      <div style={{ width: "100%", maxWidth: "460px", margin: "0 auto", padding: "0 24px", position: "relative", zIndex: 10 }}>
        <div style={{ background: "rgba(255,255,255,0.97)", borderRadius: "24px", padding: "48px 44px 40px", boxShadow: "0 32px 80px rgba(0,0,0,0.4)", position: "relative" }}>
          {/* Gold top accent */}
          <div style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: "80px", height: "3px", background: "linear-gradient(90deg, var(--brand-accent), #e8c96a, var(--brand-accent))", borderRadius: "0 0 4px 4px" }} />

          {/* Back button for forgot password */}
          {showForgot && (
            <button onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
              style={{ position: "absolute", top: "20px", left: "20px", background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: "5px", color: "#9ca3af", fontSize: "12px", fontFamily: "'Poppins', sans-serif" }}>
              <ArrowLeft size={14} /> Back
            </button>
          )}

          {/* Logo */}
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "72px", height: "72px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", borderRadius: "18px", marginBottom: "14px", boxShadow: "0 8px 24px rgba(27,42,74,0.35)", position: "relative" }}>
              <img src={logoSrc} alt={companyName} style={{ width: "48px", maxHeight: "48px", objectFit: "contain", filter: branding?.logoUrl ? "none" : "brightness(0) invert(1)" }} />
              <div style={{ position: "absolute", inset: 0, borderRadius: "18px", border: "1px solid rgba(201,168,76,0.4)" }} />
            </div>
            <h1 style={{ color: "var(--brand-primary)", margin: "0 0 4px", fontSize: "22px", fontWeight: 700, letterSpacing: "-0.3px", fontFamily: "'Poppins', sans-serif" }}>{companyName}</h1>
            <p style={{ color: "#8896a4", margin: 0, fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
              {showForgot ? "Reset your password" : "Secure Company File Management"}
            </p>
          </div>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "24px" }}>
            <div style={{ flex: 1, height: "1px", background: "#e8ecf0" }} />
            <div style={{ width: "6px", height: "6px", background: "var(--brand-accent)", borderRadius: "50%" }} />
            <div style={{ flex: 1, height: "1px", background: "#e8ecf0" }} />
          </div>

          {/* FORGOT PASSWORD VIEW */}
          {showForgot ? (
            forgotSent ? (
              <div style={{ textAlign: "center", padding: "10px 0 20px" }}>
                <div style={{ width: "56px", height: "56px", borderRadius: "16px", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
                  <Check size={28} color="#22c55e" />
                </div>
                <h3 style={{ margin: "0 0 8px", color: "var(--brand-primary)", fontSize: "16px", fontWeight: 700, fontFamily: "'Poppins', sans-serif" }}>Check your email</h3>
                <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                  Password reset instructions sent to <strong>{forgotEmail}</strong>
                </p>
                <button onClick={() => { setShowForgot(false); setForgotSent(false); setForgotEmail(""); }}
                  style={{ width: "100%", padding: "12px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "12px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif" }}>
                  Back to Sign In
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword}>
                <p style={{ margin: "0 0 20px", color: "#6b7280", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                  Enter your email address and we'll send you a link to reset your password.
                </p>
                <div style={{ marginBottom: "20px" }}>
                  <label style={{ display: "block", color: "#374151", fontSize: "13px", fontWeight: 500, marginBottom: "8px", fontFamily: "'Poppins', sans-serif" }}>Email Address</label>
                  <div style={{ position: "relative" }}>
                    <Mail size={16} color="#9ca3af" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)" }} />
                    <input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="your@hexatech.io"
                      style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px 12px 42px", border: "1.5px solid #e5e7eb", borderRadius: "12px", fontSize: "14px", color: "#1f2937", background: "#f9fafb", outline: "none", fontFamily: "'Poppins', sans-serif" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                  </div>
                </div>
                <button type="submit" disabled={forgotLoading}
                  style={{ width: "100%", padding: "14px", background: forgotLoading ? "#9ca3af" : "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 600, cursor: forgotLoading ? "not-allowed" : "pointer", fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 16px rgba(27,42,74,0.35)" }}>
                  {forgotLoading ? "Sending..." : "Send Reset Link"}
                </button>
              </form>
            )
          ) : (
            /* LOGIN VIEW */
            <>
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: "18px" }}>
                  <label style={{ display: "block", color: "#374151", fontSize: "13px", fontWeight: 500, marginBottom: "8px", fontFamily: "'Poppins', sans-serif" }}>Email Address</label>
                  <div style={{ position: "relative" }}>
                    <Mail size={16} color="#9ca3af" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="your@hexatech.io"
                      style={{ width: "100%", boxSizing: "border-box", padding: "12px 14px 12px 42px", border: "1.5px solid #e5e7eb", borderRadius: "12px", fontSize: "14px", color: "#1f2937", background: "#f9fafb", outline: "none", fontFamily: "'Poppins', sans-serif" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                  </div>
                </div>

                <div style={{ marginBottom: "16px" }}>
                  <label style={{ display: "block", color: "#374151", fontSize: "13px", fontWeight: 500, marginBottom: "8px", fontFamily: "'Poppins', sans-serif" }}>Password</label>
                  <div style={{ position: "relative" }}>
                    <Lock size={16} color="#9ca3af" style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} />
                    <input type={showPass ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••"
                      style={{ width: "100%", boxSizing: "border-box", padding: "12px 44px 12px 42px", border: "1.5px solid #e5e7eb", borderRadius: "12px", fontSize: "14px", color: "#1f2937", background: "#f9fafb", outline: "none", fontFamily: "'Poppins', sans-serif" }}
                      onFocus={(e) => (e.target.style.borderColor = "var(--brand-accent)")} onBlur={(e) => (e.target.style.borderColor = "#e5e7eb")} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#9ca3af", padding: 0 }}>
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "var(--brand-accent)" }} />
                    <span style={{ color: "#6b7280", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>Remember me</span>
                  </label>
                  <button type="button" onClick={() => { setShowForgot(true); setForgotEmail(email); }}
                    style={{ color: "var(--brand-accent)", fontSize: "13px", cursor: "pointer", fontFamily: "'Poppins', sans-serif", fontWeight: 500, background: "none", border: "none", padding: 0 }}>
                    Forgot password?
                  </button>
                </div>

                {error && (
                  <div style={{ background: "#fef2f2", borderLeft: "3px solid #ef4444", borderRadius: "8px", padding: "10px 14px", marginBottom: "16px", color: "#dc2626", fontSize: "13px", fontFamily: "'Poppins', sans-serif" }}>
                    {error}
                  </div>
                )}

                <button type="submit"
                  style={{ width: "100%", padding: "14px", background: "linear-gradient(135deg, var(--brand-primary), var(--brand-primary-light))", color: "white", border: "none", borderRadius: "12px", fontSize: "15px", fontWeight: 600, cursor: "pointer", fontFamily: "'Poppins', sans-serif", boxShadow: "0 4px 16px rgba(27,42,74,0.35)" }}>
                  Sign In to Vault
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", fontSize: "12px", marginTop: "24px", fontFamily: "'Poppins', sans-serif" }}>
          Powered by <span style={{ color: "var(--brand-accent)", opacity: 0.8 }}>HexaTech</span> · Vault v2.1.0
        </p>
      </div>
    </div>
  );
}
