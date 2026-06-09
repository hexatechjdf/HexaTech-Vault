# HexaTech Vault — Next.js port

This is the Next.js 14 (App Router) port of the Vite app at `../src/`. The Vite
app is preserved alongside this one — nothing outside `next-app/` was modified
when this scaffold was created.

> **TL;DR.** Run `npm install && npm run dev` in this directory. The app starts in
> **mock mode** (no Supabase needed). Use the role buttons on the login screen to
> jump straight into the dashboards. **Real login is intentionally not implemented
> yet — see the auth plan in `../GETTING_STARTED.md`.**

## What's done

- **Scaffold.** App Router under `app/`, root `layout.tsx` mounts `globals.css` and `<Toaster />`.
- **Routes.**
  - `/` redirects to `/login`.
  - `/login` (in the `(auth)` group) renders the existing `LoginPage` UI. The demo
    role buttons wire into `useAuth().loginAsRole(role)` so the rest of the app
    is demoable in mock mode without any auth implementation.
  - `/dashboard`, `/files`, `/folders`, `/audit`, `/storage`, `/settings`, `/users`
    live in the `(app)` group. The `(app)/layout.tsx` mounts `<AuthProvider>` and
    the existing sidebar/header `Layout`, replacing the old `currentScreen`
    state-machine with `usePathname()` + `router.push()`.
- **Backend abstraction.** `lib/backend/` mirrors the Vite app:
  - `MockBackend` (localStorage) is the default and runs the whole app immediately.
  - `SupabaseBackend` (fetch → existing Edge Functions) is used when
    `NEXT_PUBLIC_BACKEND_MODE=supabase` and `NEXT_PUBLIC_SUPABASE_URL` is set.
- **Supabase infra.** `lib/supabase/{client,server,admin}.ts` are wired but unused.
  The cookie-based middleware (`middleware.ts`) calls `auth.getUser()` to refresh
  the session, but does NOT gate any routes yet.
- **Component port.** Every feature component from `src/app/components/*.tsx`
  was ported into `components/*.tsx` with `"use client"` and path aliases.
- **Env rename.** All `VITE_*` env vars became `NEXT_PUBLIC_*` (`config.ts`).
  Server-only secret: `SUPABASE_SERVICE_ROLE_KEY`.

## What's pending (deliberately stubbed)

These are STUBS that return `501 Not Implemented`, and call sites toast a clear
error pointing at the auth plan. The plan to wire them up is in
`../GETTING_STARTED.md`:

- **`POST /api/auth/login`** — will call `supabase.auth.signInWithPassword` via
  `lib/supabase/server.ts` and persist the session via `cookies()`.
- **`POST /api/auth/logout`** — will call `auth.signOut()` server-side.
- **`POST /api/admin/users`** — will verify the caller is `super_admin`,
  then use `lib/supabase/admin.ts` (service role) to invite/create the auth user
  and insert the matching `app_users` row.
- **Session-based route gating in `middleware.ts`** — currently just refreshes
  the cookie; once login lands, it'll redirect unauthenticated users to `/login`
  and enforce role-based access for `(app)` routes mirroring `ALLOWED_SCREENS`
  from the original `App.tsx`.
- **`LoginPage` email/password submit** — currently just toasts
  `"Login is not implemented yet"`. Will POST to `/api/auth/login`.

## Quick start

```bash
cd next-app
npm install
cp .env.example .env.local   # the defaults run in mock mode
npm run dev
```

Open <http://localhost:3000>, click any role button on the login page, and you
should land in the matching dashboard.

To run against a real Supabase project, fill in the Supabase env vars in
`.env.local` and set `NEXT_PUBLIC_BACKEND_MODE=supabase`. Be aware that the
email/password login is still a stub at that point — the role buttons will
also stop working in supabase mode because they intentionally throw.

## Notes / known caveats

- Nothing in this scaffold has been built or run. The author had no network or
  package install available; the code is structured to compile and run once
  `npm install` succeeds. Please report any TypeScript errors back so they can
  be fixed in the next iteration.
- **You must copy the two logo PNGs manually before running.** The sandboxed
  scaffolder couldn't copy binary files. Do this from the repo root:
  ```sh
  cp src/imports/HTS_Logo.png next-app/public/imports/HTS_Logo.png
  cp src/imports/HTS_Logo_W.png next-app/public/imports/HTS_Logo_W.png
  ```
  Without those two files the sidebar logo and login logo will 404, but the
  rest of the app still works.
- **Not all shadcn UI primitives were ported.** Only the subset actually
  referenced by feature components plus the no-`"use client"` ones were
  written into `components/ui/`. The remaining 36 files (accordion, dialog,
  dropdown-menu, table, tabs, etc.) live in `src/app/components/ui/` of the
  Vite app and already start with `"use client";`. To bring them across,
  copy them verbatim:
  ```sh
  cp -r src/app/components/ui/*.tsx next-app/components/ui/
  ```
  None of the currently-rendered feature components import these primitives,
  so the demo runs without them — but ports of future components might need
  them.
- The `MockBackend` writes to `localStorage` under the key `hexatech_vault_mock_v1`.
  To reset the demo data, clear that key (DevTools → Application → Local Storage).
- `tailwind.config.ts` content paths cover `app/**` and `components/**`. The
  existing feature components use inline styles heavily and don't actually
  depend on Tailwind classes, so a missing Tailwind setup wouldn't break them —
  but the UI primitive components in `components/ui/` DO use Tailwind.
- All assets (logos) live under `public/imports/` and are referenced as
  `/imports/HTS_Logo.png` etc.
