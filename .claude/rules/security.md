# Security rules — the do-not-do list

Apply at all times. These are the project's hard security boundaries — violations are bugs of the highest severity.

## Tokens & secrets

- ❌ **Never expose any Google access token or refresh token to the browser.** Not in HTML, not in JSON responses, not in cookies, not in headers, not in console logs. Tokens live exclusively in Postgres (encrypted) and in Edge Function memory.
- ❌ **Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.** Files that read it (`lib/supabase/admin.ts`) must only be imported from server-only modules (`app/api/**/route.ts`, server actions, `middleware.ts`).
- ❌ **Never log a token, password, encryption key, or session cookie** — even at `debug` level, even temporarily. `console.log({ accessToken })` in a 5-minute debug session ends up in your terminal scrollback / process logs.
- ❌ **Never put secrets in `.env.example`, CLAUDE.md, rules, or skills.** Use placeholders like `<your-key-here>`.
- ❌ **Never commit `.env.local`.** It's in `.gitignore` and denied by `settings.json`. Don't override.

## Identity

- ❌ **Never trust `userId` / `role` / `actorId` from a request body.** Always derive the caller's identity from the session cookie (BFF) or JWT (Edge Function).
- ❌ **Never accept a role / department / level change without re-verifying the caller's authority.** A user editing their own role is the classic privilege-escalation bug.
- ❌ **Never let a non-super-admin grant a permission level higher than their own.** The mock backend clamps; the Edge Functions must too (`folder-create` and `permissions-set` do this).

## Drive scope

- ❌ **Never call Drive without `assertWithinRoot`.** Every Drive read/write Edge Function must verify the target's ancestor chain includes the company root folder. This applies even to super_admin (defence in depth).
- ❌ **Never list Drive root broadly.** Constrain to the company root subtree via `'<root_folder_id>' in parents` (recursive) or via the cached `folders.path`.
- ❌ **Never let the OAuth callback proceed if `drive_connection.locked = true`.** Re-check inside the callback (race guard).

## Auth flow

- ❌ **Never disable email confirmation for production accounts** except for the bootstrap super admin (auto-confirm via Studio is acceptable for that one user).
- ❌ **Never log a user in by setting cookies manually.** Use `@supabase/ssr`'s `signInWithPassword` / `signOut` — the helper handles the cookie format, refresh, and expiry correctly.
- ❌ **Never bypass RLS by using `supabaseAdmin()` for "just this one query"** if the right pattern is a server-scoped client. Service-role usage is for genuinely admin operations.

## Database

- ❌ **Never disable RLS on a table** — even "temporarily" during development. If a query needs to bypass RLS, use the service-role client.
- ❌ **Never write to `audit_log`** with `result: "success"` before the action has actually succeeded. Audit *what happened*, not *what you tried*.
- ❌ **Never UPDATE or DELETE `audit_log` rows** outside of the retention purge job.

## CORS & cookies

- ❌ **Never set `Access-Control-Allow-Origin: *`** on an authenticated endpoint. Same-origin Next.js fetches don't need CORS at all.
- ❌ **Never set `SameSite=None` on an auth cookie** unless you have a documented cross-site requirement. The Supabase helper defaults are correct.

## Logging & telemetry

- ❌ **Never include request bodies in logs by default** — they may contain secrets, file names that reveal user data, etc. Redact / whitelist what's logged.
- ❌ **Never include the full `app_users` row in client responses.** Whitelist fields.

## What to do instead

| Need | Pattern |
|---|---|
| Add a privileged endpoint | Auth check (cookie) → role check → input validation → admin client only for the privileged step → audit log → sanitized response. See [`rules/api.md`](api.md). |
| Debug an auth flow | `console.log({ userId: user.id })` — never the token. |
| Test as a different user | Sign in as that user in a private window. Don't reuse session cookies. |
| Reset for testing | Spin up a fresh local Supabase. Don't `supabase db reset` shared environments (denied in `settings.json`). |

## Reporting

If you spot a security mistake in the codebase while doing other work, **stop and fix it** (or file it explicitly to the user — don't quietly leave it). Security debt compounds.
