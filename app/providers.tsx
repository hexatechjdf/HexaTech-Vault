"use client";

// Root client-side providers.
//
// - TanStack React Query for data fetching/caching.
// - <BrandingApplier> reads the singleton branding row (cached) and writes
//   the primary / accent colors into CSS custom properties on the <body>,
//   so any component using `var(--brand-primary)` updates live when an
//   admin saves new colors in Settings.
//
// Defaults chosen for an internal admin tool:
//   - staleTime 60s: queries don't refetch on every tab focus when the data
//     was just loaded; saves duplicate BFF round-trips when modals open/close.
//   - refetchOnWindowFocus disabled: feels noisy for a dashboard-style app.
//   - retry: 1 — light retry for transient network blips, without masking
//     real errors.

import { ReactNode, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useBranding } from "@/lib/queries/branding";

// Convert a `#RRGGBB` (or shorthand `#RGB`) hex string into a lighter shade by
// pushing it toward white by `pct` of the way. Used to derive the gradient
// endpoint (`--brand-primary-light`) from the primary, so navy → lighter-navy
// gradients still look natural after a brand-color change.
function lighten(hex: string, pct: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const num = parseInt(h, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;
  const lift = (c: number) => Math.round(c + (255 - c) * pct);
  const to2 = (n: number) => n.toString(16).padStart(2, "0");
  return `#${to2(lift(r))}${to2(lift(g))}${to2(lift(b))}`;
}

function BrandingApplier() {
  const { data } = useBranding();
  useEffect(() => {
    if (!data) return;
    const body = typeof document !== "undefined" ? document.body : null;
    if (!body) return;
    body.style.setProperty("--brand-primary", data.primaryColor);
    body.style.setProperty("--brand-accent", data.accentColor);
    // Derive a ~18% lighter shade for gradient endpoints. Matches the original
    // navy → lighter-navy (#1B2A4A → #2a3f6e) feel for any chosen primary.
    body.style.setProperty("--brand-primary-light", lighten(data.primaryColor, 0.18));
  }, [data]);
  return null;
}

export function Providers({ children }: { children: ReactNode }) {
  // Create the client once per React tree mount; useState ensures it survives
  // re-renders but does NOT survive a full page reload (which is what we want
  // for SSR/Next — each navigation re-uses the same client; each reload starts
  // fresh).
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BrandingApplier />
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
