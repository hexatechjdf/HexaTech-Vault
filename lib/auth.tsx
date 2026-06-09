"use client";

// Auth context for the Next.js app.
//
// MOCK mode: keeps the demo role-picker login UX (localStorage session + seeded MockBackend).
// SUPABASE mode: `initialUser` is resolved server-side in app/(app)/layout.tsx via the cookie
// session and passed in as a prop, so this provider hydrates synchronously without a client
// auth roundtrip. Login itself goes through the server action in app/(auth)/login/actions.ts;
// logout goes through POST /api/auth/logout (which calls supabase.auth.signOut on the server).

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { AppUser, Role } from "./types";
import { getBackend } from "./backend";
import { BACKEND_MODE } from "./config";

const SESSION_KEY = "hexatech_vault_session_v1";
const DEMO_PASSWORD = "password123";

// Maps the demo role buttons to known accounts (used for the role-picker login in mock mode).
const ROLE_EMAIL: Record<Role, string> = {
  super_admin: "zara@hexatech.io",
  admin: "omar@hexatech.io",
  manager: "sara@hexatech.io",
  team_lead: "ali@hexatech.io",
  lead_dev: "raza@hexatech.io",
  team_member: "hina@hexatech.io",
};

interface StoredSession {
  user: AppUser;
  accessToken?: string | null;
}

interface AuthContextValue {
  user: AppUser | null;
  loading: boolean;
  loginAsRole: (role: Role) => Promise<void>;
  loginWithPassword: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  /** Pre-resolved user from the server-side session. Supabase mode only — null in mock mode. */
  initialUser?: AppUser | null;
  children: ReactNode;
}

export function AuthProvider({ initialUser, children }: AuthProviderProps) {
  const isSupabase = BACKEND_MODE === "supabase";
  const [user, setUser] = useState<AppUser | null>(initialUser ?? null);
  // In supabase mode the user is hydrated synchronously from the server prop — no loading state.
  // In mock mode we need to read localStorage in an effect, so we start in "loading".
  const [loading, setLoading] = useState(!isSupabase && !initialUser);

  // Keep the backend "actor" in sync with whoever is signed in.
  useEffect(() => {
    getBackend().setActor(user, null);
  }, [user]);

  // Mock-mode session restoration from localStorage.
  useEffect(() => {
    if (isSupabase) return;
    try {
      if (typeof window !== "undefined") {
        const raw = window.localStorage.getItem(SESSION_KEY);
        if (raw) {
          const s = JSON.parse(raw) as StoredSession;
          getBackend().setActor(s.user, s.accessToken ?? null);
          setUser(s.user);
        }
      }
    } catch {
      /* ignore corrupt state */
    }
    setLoading(false);
  }, [isSupabase]);

  function applyMockSession(session: StoredSession | null) {
    if (session) {
      getBackend().setActor(session.user, session.accessToken ?? null);
      setUser(session.user);
      try {
        if (typeof window !== "undefined") window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        /* ignore */
      }
    } else {
      getBackend().setActor(null, null);
      setUser(null);
      if (typeof window !== "undefined") window.localStorage.removeItem(SESSION_KEY);
    }
  }

  async function loginWithPassword(email: string, password: string) {
    if (isSupabase) {
      throw new Error("Use the login form — submission is handled by the server action.");
    }
    const users = await getBackend().listUsers();
    const u = users.find((x) => x.email.toLowerCase() === email.toLowerCase());
    if (!u || password !== DEMO_PASSWORD) throw new Error("Invalid email or password.");
    applyMockSession({ user: u });
  }

  async function loginAsRole(role: Role) {
    if (isSupabase) {
      throw new Error("Demo role login is mock-mode only.");
    }
    const users = await getBackend().listUsers();
    const u = users.find((x) => x.role === role);
    if (!u) throw new Error("No demo user for that role.");
    applyMockSession({ user: u });
  }

  async function logout() {
    if (isSupabase) {
      // Tell the server to clear the session cookie; even if the request fails, clear locally.
      try {
        await fetch("/api/auth/logout", { method: "POST" });
      } catch {
        /* network failure — still clear locally below */
      }
      getBackend().setActor(null, null);
      setUser(null);
    } else {
      applyMockSession(null);
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, loginAsRole, loginWithPassword, logout }),
    [user, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}

export { ROLE_EMAIL };
