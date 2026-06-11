// Next.js middleware. Two jobs:
//   1) Refresh the Supabase auth cookie on every request (keeps the session alive).
//   2) Route gating: bounce unauthenticated users away from (app) routes to /login,
//      and bounce signed-in users away from /login to /dashboard.
//
// Mock mode pass-through: if Supabase env vars are unset we do nothing (no session to
// refresh, no gating to apply — the client-side AuthProvider handles mock sessions).

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ROUTE_TO_TAB, type TabName } from "@/lib/tabs";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/files",
  "/folders",
  "/tabs",
  "/audit",
  "/storage",
  "/settings",
  "/users",
];

function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/"),
  );
}

function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Mock mode (or before Supabase is configured): pass through, no gating.
  if (!supabaseUrl || !supabaseAnonKey) return response;

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return request.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        request.cookies.set({ name, value, ...options });
        response.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        request.cookies.set({ name, value: "", ...options });
        response.cookies.set({ name, value: "", ...options });
      },
    },
  });

  // Refresh + read the user. getUser() also writes any refreshed cookie to `response`.
  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;

  // Bounce unauthenticated users away from protected routes.
  if (isProtectedPath(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Preserve where they were heading so the login action can return them there.
    if (pathname !== "/") url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  // Bounce signed-in users away from /login.
  if (isLoginPath(pathname) && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.delete("redirect");
    return NextResponse.redirect(url);
  }

  // Send the user to /login when they hit the root.
  if (pathname === "/" && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (pathname === "/" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  // ─── Tab-level access gating ───
  // /tabs is super-admin only by hardcoded check (it's the bootstrap point
  // for granting any other tab access — can't itself be granted away). All
  // other tab routes go through the engine: get_effective_tab_level returns
  // 'action' for super_admin (short-circuit), the user's effective level
  // otherwise, or 'no_access' if no grant matches.
  if (user) {
    if (pathname === "/tabs" || pathname.startsWith("/tabs/")) {
      const { data: appUser } = await supabase
        .from("app_users").select("role").eq("id", user.id).maybeSingle();
      if (appUser?.role !== "super_admin") {
        const url = request.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }
    } else {
      const tab = pathToTab(pathname);
      if (tab) {
        const { data: level } = await supabase.rpc("get_effective_tab_level", {
          p_user: user.id, p_tab: tab,
        });
        if (!level || level === "no_access") {
          const url = request.nextUrl.clone();
          url.pathname = "/dashboard";
          return NextResponse.redirect(url);
        }
      }
    }
  }

  return response;
}

/** Map a URL pathname to the tab it belongs to (or null if none). */
function pathToTab(pathname: string): TabName | null {
  for (const [route, tab] of Object.entries(ROUTE_TO_TAB)) {
    if (pathname === route || pathname.startsWith(route + "/")) return tab as TabName;
  }
  return null;
}

export const config = {
  // Run on all routes except Next internals, static assets, and the API healthcheck.
  // The /api/auth/* and /api/admin/* routes ARE matched — they do their own auth checks.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|imports/|api/_health).*)",
  ],
};
