---
name: deploy
description: End-to-end deployment workflow for the Next.js app + Supabase backend (migrations + Edge Functions). Use this before promoting changes to staging or production.
---

# /deploy — Ship the app + backend safely

Use this skill when you're ready to deploy. It enforces the correct order so backend changes land before frontend changes that depend on them.

## Inputs you need before starting

- The target environment (`staging` / `production`).
- Which side is changing: frontend only, backend only, or both.
- Confirmation that `main` is clean and CI is green (if CI exists).

## Pre-flight checks (don't skip)

1. **Git state is clean.** `git status` shows nothing uncommitted. Working tree on the deploy branch (usually `main`).
2. **Local build passes.** `npm run build` inside `next-app/`. Fix any type errors here — production deploys should never be the place a type error is first seen.
3. **Lint clean** if eslint is configured: `npm run lint`.
4. **No `.env.local` shenanigans.** The deploy uses the target environment's env vars from Vercel/the host — confirm they're set there, not relying on local values.

## Backend deploy (do this FIRST when both sides are changing)

The frontend often depends on backend changes (new endpoints, new columns). Deploy backend changes first; they're additive and backward-compatible if done right.

1. **Review pending migrations.**
   ```bash
   supabase migration list --linked
   ```
   New migrations must be backward-compatible with the currently-deployed frontend. Adding columns: yes. Renaming/dropping: only after the frontend has stopped using the old name in a prior deploy.

2. **Push migrations.**
   ```bash
   supabase db push
   ```
   It will diff and ask for confirmation. Read the diff before saying yes. **`supabase db reset` is denied by `settings.json`** for a reason.

3. **Deploy Edge Functions.**
   ```bash
   supabase functions deploy <name>          # one function
   supabase functions deploy                  # all functions
   ```
   List them first: `supabase functions list`.

4. **Confirm secrets are set** for the project (read names, not values):
   ```bash
   supabase secrets list
   ```
   Required: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `TOKEN_ENCRYPTION_KEY`, `COMPANY_ROOT_NAME`, `CRON_SECRET`.

5. **Smoke-test the new functions.** From the Studio's function logs tab, invoke or watch for the first real call. The function should return a sensible response (or 401 for unauthenticated).

## Frontend deploy

1. **Confirm env vars are set in the host** (Vercel → Project → Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` *(only on Server-side environments; never expose to browser)*
   - `NEXT_PUBLIC_BACKEND_MODE=supabase`
   - `NEXT_PUBLIC_COMPANY_ROOT_NAME` (matches the backend secret)

2. **Trigger the deploy.** Push to the deploy branch (Vercel auto-deploys), or run the host's CLI deploy.

3. **Wait for build completion.** Don't bounce — the Next.js build runs `tsc` so a type error here means rollback.

## Post-deploy verification

1. **`/login` loads** (test in an incognito window).
2. **Log in as Super Admin** and confirm:
   - Settings → Google Drive shows `Connected` with the right account.
   - Settings → "Sync now" succeeds (or recent `Last synced` is fresh).
   - `Folder Access Control` lists real folders/users.
3. **Check the audit_log** in Studio for the deploy-window — should see a healthy mix of normal actions, no `result='failure'` spikes.
4. **Cron health.** If you deployed within the hour-mark, watch for the next scheduled `sync-drive` run.

## If something breaks

- **Frontend error after deploy:** roll back the frontend deploy (Vercel's "Promote to Production" → previous deploy). Leave the backend in place if backend was correct.
- **Backend migration error:** if the migration partially applied, write a forward-fix migration. **Don't manually edit `auth.users` or `app_users` in the Studio** to "patch it up" — write a migration so the fix is reproducible.
- **Edge Function returning 500:** check Studio → Functions → Logs. Common causes: missing secret, type mismatch with the migration, JWT verify failure.

## Don't do these during a deploy

- ❌ Skip `npm run build` because "I just changed a comment".
- ❌ Run `supabase db reset` against the deployed project. Ever.
- ❌ Deploy frontend before backend if the frontend depends on new backend code.
- ❌ Rotate `SUPABASE_SERVICE_ROLE_KEY` without immediately updating Vercel + Edge Function env. Old key in use = a window of failed admin operations.
- ❌ Mark this skill complete if any of the post-deploy checks failed.

## Output

When done, report:
- Migrations applied (count + names).
- Functions deployed (names).
- Frontend commit SHA deployed.
- Post-deploy check results (✅/❌ each).
- Any rollbacks performed.
