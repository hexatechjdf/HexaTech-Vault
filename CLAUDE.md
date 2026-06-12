# HexaTech Vault — Next.js app (project brain)

You are working in **`next-app/`**, the Next.js conversion of HexaTech Vault — an internal file & access-management platform that fronts a **single company Google Drive** via a **Supabase** backend (Postgres + Auth + Edge Functions + pg_cron).

This `next-app/` is the **active workspace**. The legacy Vite app at the repo root is preserved as reference but is no longer under active development.

## Stack at a glance

- Next.js 14 (App Router) · TypeScript · Tailwind 4 · `@supabase/ssr` · `@tanstack/react-query` · sonner · lucide-react
- Backend lives in `supabase/` (migrations, RLS, Edge Functions, pg_cron). It is the only thing that talks to Google Drive.
- **Login is implemented** via `@supabase/ssr` cookie sessions. Server action [`app/(auth)/login/actions.ts`](app/(auth)/login/actions.ts) calls `signInWithPassword`; [`middleware.ts`](middleware.ts) gates protected routes and enforces tab-level access via `get_effective_tab_level()`; the (app) layout resolves the `app_users` profile server-side. Bootstrap a super admin via [`supabase/bootstrap_super_admin.sql`](supabase/bootstrap_super_admin.sql).
- **User Management is complete.** Invite / create-with-password, edit profile, role+department change, status toggle (deactivate / reactivate), password reset, hard-delete, per-user effective-access view, and per-user audit history are all wired. UI: [`components/UserManagement.tsx`](components/UserManagement.tsx). BFF: [`app/api/admin/users/route.ts`](app/api/admin/users/route.ts) (list / create) + [`app/api/admin/users/[id]/route.ts`](app/api/admin/users/[id]/route.ts) (PATCH discriminated by `action`, DELETE).
- **Client data layer is TanStack React Query.** Hooks live in [`lib/queries/`](lib/queries/) (one file per feature: users, audit, drive, drive-files, backup, branding, permissions, tab-permissions, profile). Defaults set in [`app/providers.tsx`](app/providers.tsx). See [`.claude/rules/frontend.md`](.claude/rules/frontend.md) for the pattern. Drive-touching operations still go through the `getBackend()` abstraction (`MockBackend` / `SupabaseBackend`); the two layers compose.
- **Runs without Supabase** via a swappable `MockBackend` (default). Set `NEXT_PUBLIC_BACKEND_MODE=supabase` + URL/anon key to switch. (Mock mode covers Drive-side operations only; BFF endpoints under `/api/admin/*` always hit the real Next.js BFF.)

## Architectural pillars — these are invariants

1. **Single company Drive identity.** Backend holds the only Google credentials. Every Drive call: verify JWT → resolve permission → assert root-scope → call Drive → audit. Users never touch Drive directly.
2. **Permission engine is the source of truth.** [`lib/permissions.ts`](lib/permissions.ts) defines the capability matrix; [`supabase/migrations/0002_rls_and_functions.sql`](supabase/migrations/0002_rls_and_functions.sql) `get_effective_level()` (rewritten user-wins in [`0018`](supabase/migrations/0018_user_wins_permission_engine.sql)) mirrors it in SQL. The tab engine has the same two-sided structure: [`lib/tabs.ts`](lib/tabs.ts) + [`get_effective_tab_level()`](supabase/migrations/0026_tab_permissions.sql). **Change one without the other and authorization breaks.** See [`.claude/rules/permissions.md`](.claude/rules/permissions.md).
3. **Service-role key is server-only.** [`lib/supabase/admin.ts`](lib/supabase/admin.ts) MUST NEVER be imported from a `"use client"` file or any module reachable in the browser bundle.
4. **Root-folder scoping.** All operations confined to the company root folder. Never list/create/delete outside it.
5. **No Google tokens in the browser.** Ever.

## Feature surfaces (what the app does today)

Beyond the core User Management + File Manager + Folder Access Control:

- **Tab Access Control** ([`/tabs`](app/(app)/tabs/page.tsx), [`components/TabAccessControl.tsx`](components/TabAccessControl.tsx)) — super-admin-only screen for granting per-tab access (No Access / View / View+Action) at user level, role+department level, or unscoped role level. Engine: migrations [`0026`](supabase/migrations/0026_tab_permissions.sql) + [`0027`](supabase/migrations/0027_default_file_manager_access.sql); Edge Functions `tab-permissions-{get,set}`; BFF [`app/api/admin/tabs/permissions/route.ts`](app/api/admin/tabs/permissions/route.ts). See [`.claude/rules/permissions.md`](.claude/rules/permissions.md) "Tab Permission System" section.
- **Password reset — two flows.** **(a) User-initiated forgot-password:** `/login` → "Forgot password?" → email link → [`/reset-password`](app/(auth)/reset-password/) → set new password. Rate-limited per migration [`0023`](supabase/migrations/0023_password_reset_tracking.sql). **(b) Admin-initiated reset:** User Management row → "Reset password" → super-admin sets the new password directly via [`PATCH /api/admin/users/[id]`](app/api/admin/users/[id]/route.ts) with `action: "reset_password"`.
- **Backup.** Daily pg_cron schedule + manual "Run now" via [`POST /api/admin/backup/run`](app/api/admin/backup/run/route.ts). Artefacts downloadable via [`/api/admin/backup/runs/[id]/download`](app/api/admin/backup/runs/[id]/download/route.ts). Settings UI in [`components/Settings.tsx`](components/Settings.tsx) "Backup" tab. Schema in migrations [`0019`](supabase/migrations/0019_backup.sql) + [`0020`](supabase/migrations/0020_cron_backup.sql); Edge Function `backup-run`.
- **Proposal cloning.** Clones a "template" subtree of the company root into a new project folder named with the company short code + proposal label. Edge Function `proposal-clone`, BFF [`app/api/admin/drive/proposals/clone/route.ts`](app/api/admin/drive/proposals/clone/route.ts), label schema in migration [`0024`](supabase/migrations/0024_proposal_label.sql).
- **Branding + company short code.** Super Admin sets primary/accent colours and a short code via [`components/Settings.tsx`](components/Settings.tsx) → Company Info. Colours are applied at runtime via CSS custom properties on `<body>` ([`app/providers.tsx`](app/providers.tsx) → `<BrandingApplier>`). Short code feeds proposal naming. Migrations [`0006`](supabase/migrations/0006_branding.sql) + [`0025`](supabase/migrations/0025_company_short_code.sql); BFF [`app/api/admin/branding/route.ts`](app/api/admin/branding/route.ts) + `branding/logo/route.ts`.

## Directory map (this is the canonical layout)

```
next-app/
├── app/
│   ├── (auth)/
│   │   ├── login/                     ← Login UI (posts to server action in actions.ts)
│   │   ├── forgot-password/           ← User-initiated email reset request
│   │   └── reset-password/            ← Set new password from email link
│   ├── (app)/                         ← Authenticated route group
│   │   ├── layout.tsx                 ← Server-side: loads app_users from cookie, hydrates <Layout>
│   │   ├── dashboard/page.tsx
│   │   ├── files/page.tsx             ← File Manager
│   │   ├── folders/page.tsx           ← Folder Access Control
│   │   ├── tabs/page.tsx              ← Tab Access Control (super-admin only)
│   │   ├── users/page.tsx             ← User Management
│   │   ├── audit/page.tsx             ← Audit Logs
│   │   ├── storage/page.tsx           ← Storage Overview
│   │   ├── settings/page.tsx          ← Settings (Profile / Drive / Backup / Branding / Company Info)
│   │   └── profile/page.tsx           ← Self-service profile view
│   ├── api/
│   │   ├── auth/logout/route.ts                          ← supabase.auth.signOut + cookie clear
│   │   ├── me/{profile,password}/route.ts                ← Self-service
│   │   └── admin/                                        ← Super-admin (or scoped) BFF endpoints
│   │       ├── users/route.ts                            ← list + create
│   │       ├── users/[id]/route.ts                       ← PATCH (action: profile|role|status|reset_password), DELETE
│   │       ├── users/[id]/effective-access/route.ts
│   │       ├── departments/route.ts
│   │       ├── tabs/{permissions,me}/route.ts            ← Tab access read/write
│   │       ├── folders/[id]/permissions/route.ts
│   │       ├── folders/access-tree/route.ts
│   │       ├── audit-logs/route.ts
│   │       ├── backup/{config,run,runs,runs/[id]/download}/route.ts
│   │       ├── branding/{route.ts,logo/route.ts}
│   │       └── drive/{list,my-folders,sync,status,verify,trash,connect-start,files/upload,files/download,items/{delete,restore,purge},folders,proposals/clone}/route.ts
│   ├── providers.tsx                  ← QueryClientProvider + BrandingApplier
│   ├── layout.tsx                     ← Root layout (html + Toaster + Providers)
│   └── globals.css                    ← Tailwind 4 + custom styles
├── components/
│   ├── Layout.tsx LoginPage.tsx Loader.tsx Pagination.tsx
│   ├── FileManager.tsx FolderAccessControl.tsx TabAccessControl.tsx
│   ├── Settings.tsx UserManagement.tsx UserEffectiveAccess.tsx
│   ├── AuditLogs.tsx StorageOverview.tsx ProfilePage.tsx
│   ├── {SuperAdmin,Admin,Manager,TeamLead}Dashboard.tsx
│   ├── figma/ImageWithFallback.tsx
│   └── ui/                            ← shadcn primitives (available — feature components use inline styles)
├── lib/
│   ├── types.ts                       ← Role, PermLevel, FolderDTO, FileDTO, AppUser, …
│   ├── permissions.ts                 ← Folder capability matrix + helpers (SOURCE OF TRUTH on the TS side)
│   ├── tabs.ts                        ← Tab registry (must agree with migration 0026 enum)
│   ├── config.ts                      ← Env (NEXT_PUBLIC_*)
│   ├── auth.tsx                       ← AuthProvider + useAuth (mock + supabase modes; login server action handles signin)
│   ├── queries/                       ← TanStack React Query hooks — one file per feature
│   │   ├── users.ts audit.ts profile.ts drive.ts drive-files.ts
│   │   └── backup.ts branding.ts permissions.ts tab-permissions.ts
│   ├── backend/
│   │   ├── contract.ts                ← Backend interface (the API surface)
│   │   ├── index.ts                   ← getBackend() factory
│   │   ├── mockBackend.ts             ← localStorage implementation (SSR-safe)
│   │   └── supabaseBackend.ts         ← fetch to Edge Functions
│   └── supabase/
│       ├── client.ts                  ← Browser client (anon key)
│       ├── server.ts                  ← Server client (anon key + cookies)
│       └── admin.ts                   ← Service-role client — SERVER ONLY, NEVER import from client
├── middleware.ts                      ← Cookie refresh + route gating + tab-level access checks
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
- Use `useAuth()` for the current user, `capabilities(level)` for "can I do X folder-side", `tabLevelMeets(level, "action")` for "can I do X tab-side".
- For data: **BFF-routed data** (users, audit, branding, backup, tab perms, effective access) → TanStack Query hooks in [`lib/queries/`](lib/queries/); **Drive-touching operations** (folders, files, grants) → `getBackend()`. Never call `fetch("/api/...")` from a component directly — write a hook in `lib/queries/`.
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
