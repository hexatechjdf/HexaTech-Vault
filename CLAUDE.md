# HexaTech Vault — Next.js app (project brain)

You are working in **`next-app/`**, the Next.js conversion of HexaTech Vault — an internal file & access-management platform that fronts a **single company Google Drive** via a **Supabase** backend (Postgres + Auth + Edge Functions + pg_cron).

This `next-app/` is the **active workspace**. The legacy Vite app at the repo root is preserved as reference but is no longer under active development.

## Stack at a glance

- Next.js 14 (App Router) · TypeScript · Tailwind 4 · `@supabase/ssr` · sonner · lucide-react
- Backend lives in `supabase/` (migrations, RLS, Edge Functions, pg_cron). It is the only thing that talks to Google Drive.
- **Login is implemented** via `@supabase/ssr` cookie sessions. Server action [`app/(auth)/login/actions.ts`](app/(auth)/login/actions.ts) calls `signInWithPassword`; [`middleware.ts`](middleware.ts) gates protected routes; the (app) layout resolves the `app_users` profile server-side. Bootstrap a super admin via [`supabase/bootstrap_super_admin.sql`](supabase/bootstrap_super_admin.sql).
- **User provisioning is implemented** via `POST /api/admin/users` (super-admin only), with two modes: `invite` (Supabase emails an invite link) or `password` (admin sets initial password). The [User Management screen](components/UserManagement.tsx) is wired to this route.
- **In progress / next**: edit / deactivate / delete / role-change / reset-password / activity-log per user (currently "coming soon" stubs in the User Management menu).
- **Stale stub**: [`app/api/auth/login/route.ts`](app/api/auth/login/route.ts) still returns 501 but is unused — the login form posts to a server action. Safe to delete.
- **Runs without Supabase** via a swappable `MockBackend` (default). Set `NEXT_PUBLIC_BACKEND_MODE=supabase` + URL/anon key to switch.

## Architectural pillars — these are invariants

1. **Single company Drive identity.** Backend holds the only Google credentials. Every Drive call: verify JWT → resolve permission → assert root-scope → call Drive → audit. Users never touch Drive directly.
2. **Permission engine is the source of truth.** [`lib/permissions.ts`](lib/permissions.ts) defines the capability matrix; [`supabase/migrations/0002_rls_and_functions.sql`](supabase/migrations/0002_rls_and_functions.sql) `get_effective_level()` mirrors it in SQL. **Change one without the other and authorization breaks.** See [`.claude/rules/permissions.md`](.claude/rules/permissions.md).
3. **Service-role key is server-only.** [`lib/supabase/admin.ts`](lib/supabase/admin.ts) MUST NEVER be imported from a `"use client"` file or any module reachable in the browser bundle.
4. **Root-folder scoping.** All operations confined to the company root folder. Never list/create/delete outside it.
5. **No Google tokens in the browser.** Ever.

## Directory map (this is the canonical layout)

```
next-app/
├── app/
│   ├── (auth)/login/page.tsx         ← Login UI (posts to server action in actions.ts)
│   ├── (app)/                         ← Authenticated route group
│   │   ├── layout.tsx                 ← Server-side: loads app_users from cookie, hydrates <AppShell>
│   │   └── {dashboard,files,folders,audit,storage,settings,users}/page.tsx
│   ├── api/
│   │   ├── auth/login/route.ts            ← STALE 501 stub (unused — login uses the server action)
│   │   ├── auth/logout/route.ts           ← supabase.auth.signOut + cookie clear
│   │   └── admin/users/route.ts            ← Super-admin user provisioning (invite OR password)
│   ├── layout.tsx                     ← Root layout (html + Toaster)
│   └── globals.css                    ← Tailwind 4 + custom styles
├── components/
│   ├── Layout.tsx LoginPage.tsx FileManager.tsx FolderAccessControl.tsx
│   ├── Settings.tsx UserManagement.tsx AuditLogs.tsx StorageOverview.tsx
│   ├── {SuperAdmin,Admin,Manager,TeamLead}Dashboard.tsx
│   ├── figma/ImageWithFallback.tsx
│   └── ui/                            ← shadcn primitives (available — feature components use inline styles)
├── lib/
│   ├── types.ts                       ← Role, PermLevel, FolderDTO, FileDTO, AppUser, …
│   ├── permissions.ts                 ← Capability matrix + helpers (SOURCE OF TRUTH on the TS side)
│   ├── config.ts                      ← Env (NEXT_PUBLIC_*)
│   ├── auth.tsx                       ← AuthProvider + useAuth (mock + supabase modes; login server action handles signin)
│   ├── backend/
│   │   ├── contract.ts                ← Backend interface (the API surface)
│   │   ├── index.ts                   ← getBackend() factory
│   │   ├── mockBackend.ts             ← localStorage implementation (SSR-safe)
│   │   └── supabaseBackend.ts         ← fetch to Edge Functions
│   └── supabase/
│       ├── client.ts                  ← Browser client (anon key)
│       ├── server.ts                  ← Server client (anon key + cookies)
│       └── admin.ts                   ← Service-role client — SERVER ONLY, NEVER import from client
├── middleware.ts                      ← Cookie refresh (gating added when login is implemented)
└── public/imports/                    ← Logos
```

## Run

```bash
npm run dev      # http://localhost:3000 — mock mode runs end-to-end without Supabase
npm run build    # Next production build + tsc typecheck (catches errors Vite never did)
npm run lint
```

## Path conventions

- Imports: `@/lib/...`, `@/components/...` (tsconfig path alias `@/*` → `./*`).
- Types: `@/lib/types` for DTOs / `Role` / `PermLevel`; `@/lib/backend` for `Backend`, `GrantInput`, `ListResult`, `PermissionError`.
- New top-level component → `components/<Name>.tsx`.
- New route → `app/(app)/<segment>/page.tsx`.
- New BFF route → `app/api/<area>/<action>/route.ts`.

## Working in this codebase

- **Read the relevant rules file in [`.claude/rules/`](.claude/rules/) before changing things in that area.** Each is scoped to a concern (frontend, api, database, permissions, security, testing).
- Always run `npm run build` before committing UI/lib changes — Next's typecheck catches latent issues.
- All feature components are `"use client"` and use inline styles + `lucide-react`. Don't refactor them to shadcn primitives without a reason.
- Use `useAuth()` for the current user, `getBackend()` for data access, `capabilities(level)` for "can I do X".
- Mock mode persists in `localStorage` key `hexatech_vault_mock_v1` — clear it to reset demo data.

## Things to NEVER do

- Don't import `lib/supabase/admin.ts` (service role) from `"use client"` files or anything reachable by the browser bundle.
- Don't add Drive logic in the Next.js BFF — that lives in `supabase/functions/`. The BFF is for auth + admin + Next-side concerns only.
- Don't add a permission level in TS without updating the SQL function — they MUST stay in sync. Use the `/add-permission-level` skill.
- Don't bypass `assertWithinRoot` in any Drive-touching code.
- Don't add `2>&1` redirects to native commands in PowerShell — it wraps stderr in error records and confuses exit-code handling.
- Don't expose any Google access/refresh token to the client. Not in cookies, not in JSON, not in headers.

## When you're stuck

- Auth plan & bootstrap → [`../GETTING_STARTED.md`](../GETTING_STARTED.md)
- Foundation spec & schema → [`../IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md`](../IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md)
- Supabase package (migrations, Edge Functions, SETUP.md, bootstrap_super_admin.sql) → [`supabase/`](supabase/)
- Per-area rules → [`.claude/rules/`](.claude/rules/)
- Reusable workflows → [`.claude/skills/`](.claude/skills/)
- How the `.claude/` directory works → [`.claude/README.md`](.claude/README.md)
