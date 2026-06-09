// Backend selection. Defaults to "mock" so the app runs with zero cloud setup.
// Flip to "supabase" (and provide URL + anon key) once the Supabase project is deployed.
// See .env.example and ../GETTING_STARTED.md.
//
// Next.js inlines `NEXT_PUBLIC_*` env vars at build time, so this works for both
// server components and client components without any extra plumbing.

export type BackendMode = "mock" | "supabase";

export const SUPABASE_URL: string = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY: string = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

// Only use the real backend when explicitly enabled AND a URL is present.
export const BACKEND_MODE: BackendMode =
  process.env.NEXT_PUBLIC_BACKEND_MODE === "supabase" && SUPABASE_URL ? "supabase" : "mock";

export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";

export const IS_SUPABASE = BACKEND_MODE === "supabase";

// Display name of the company root folder (item 3). The backend also reads this as a secret.
export const COMPANY_ROOT_NAME = process.env.NEXT_PUBLIC_COMPANY_ROOT_NAME ?? "HexaTech Vault";
