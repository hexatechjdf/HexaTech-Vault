# Database rules — Supabase (Postgres + RLS) + the Drive metadata cache

Apply when touching `supabase/migrations/**`, RLS policies, SQL functions, the seed, or anything that reads/writes Supabase tables from server code.

## Where things live

| Path | Purpose |
|---|---|
| [`supabase/migrations/`](../../supabase/migrations/) | All schema, RLS, triggers, indexes, cron, SQL functions. |
| [`supabase/seed.sql`](../../supabase/seed.sql) | Demo departments + demo app_users (placeholder UUIDs — see bootstrap). |
| [`supabase/bootstrap_super_admin.sql`](../../supabase/bootstrap_super_admin.sql) | One-time script: links the first auth user to an `app_users` row with `role='super_admin'`. |
| [`supabase/functions/`](../../supabase/functions/) | Edge Functions (Deno). Use SQL from here via `serviceClient()`. |
| [`supabase/SETUP.md`](../../supabase/SETUP.md) | Human deploy checklist. |

## Schema invariants (don't break these)

1. **Singleton tables** — `drive_connection`, `drive_tokens`, `sync_state` — all use a `boolean PRIMARY KEY DEFAULT true CHECK (id)` so only one row can exist. Don't migrate away from this without a very good reason.
2. **`drive_connection.locked = true` is enforced by a trigger** that rejects any UPDATE/DELETE. The rotating access token lives in **`drive_tokens`** (separate row) so the locked row never mutates. Match this pattern if you add more "permanent + rotating" pairs.
3. **`app_users.id` references `auth.users(id)`** with cascade. Every app user MUST have a matching Supabase Auth user; create the auth user first, then insert the profile (see [`rules/api.md`](api.md) admin user creation).
4. **`folders.is_root` is true for exactly one row** (the company root, created during the Drive OAuth callback). Every other folder's path starts there.
5. **`audit_log` is append-only** — never UPDATE or DELETE rows (other than retention purges, and those use a dedicated retention job).

## Permission engine — TS and SQL must stay in sync

The capability matrix is defined in **two places that must agree**:
- [`lib/permissions.ts`](../../lib/permissions.ts) — `CAPABILITIES`, `PERM_LEVELS`, `PERM_LABELS`.
- [`supabase/migrations/0002_rls_and_functions.sql`](../../supabase/migrations/0002_rls_and_functions.sql) — `get_effective_level()`, `perm_level` enum.

Add or rename a level → **both** must change in the same commit. See [`/add-permission-level`](../skills/add-permission-level/SKILL.md). The `perm_level` enum order matters for ranking — preserve it.

## Row Level Security

- **RLS is enabled on every table.** Don't disable it.
- Client-side reads via the anon key MUST go through RLS policies. Server-side admin operations bypass RLS via the service-role key — that's the whole point of the split.
- Adding a table → also add RLS policies in the same migration. A table with RLS enabled but no policies returns zero rows to clients, which is the safe default but causes silent confusion.
- For tables read directly by the client (`folders`, `files`, `permission_grants`, `folder_assignees`), policies should call `get_effective_level(auth.uid(), folders.id)` (or equivalent) — never duplicate the logic.

## Migrations

- File name pattern: `NNNN_<short_topic>.sql` (e.g. `0004_user_avatars.sql`).
- One concern per migration. Don't bundle a schema change with a data fix.
- Always include `IF NOT EXISTS` for additive operations so re-runs are safe.
- Test against a fresh local Supabase before pushing.

## The Drive metadata cache

- `folders` and `files` mirror Google Drive under the root. Drive is the source of truth for **file bytes**; Postgres is the source of truth for **permissions, ownership, and the user-facing tree**.
- The hourly cron (`sync-drive` Edge Function) keeps them in sync. Don't write to `folders`/`files` outside of:
  - Drive-touching Edge Functions (`folder-create`, `drive-upload`, `drive-delete`).
  - The sync function itself.
- `deleted_at` is set when an item is trashed; rows are not hard-deleted (preserves audit chain).

## IDs & UUIDs

- All primary keys are UUIDs (`gen_random_uuid()`).
- API/request bodies use **our DB UUIDs** (`folders.id`, `files.id`) — not Drive `driveFileId`. Translation happens server-side.

## Cron / pg_cron

- The hourly sync is scheduled in `0003_cron.sql`. Don't add new cron jobs without thinking about overlap with `sync-drive` (which holds Drive API quota).
- Cron-triggered Edge Functions use a shared `CRON_SECRET` header, not a JWT. Re-check authorisation in the function body.

## Working with Supabase locally

```bash
supabase status            # health check
supabase migration list    # what's applied
supabase db push           # apply pending migrations (asks for confirmation)
supabase functions deploy  # deploy Edge Functions
supabase secrets list      # show project secrets (names only)
```

`supabase db reset` is **denied** in `.claude/settings.json` because it nukes data. Use a fresh local project if you need a reset.

## Bootstrapping a new project

Order matters:
1. Create Supabase project.
2. Run all migrations (`supabase db push`).
3. Run `seed.sql` ONLY if you want demo departments — note the demo app_users placeholder UUIDs will not match real auth users, see next step.
4. Create the first Super Admin via Dashboard → Auth → Users → Add user.
5. Run `bootstrap_super_admin.sql` with that auth UUID.
6. Deploy Edge Functions (`supabase functions deploy`).
7. Set project secrets (`supabase secrets set ...`).
8. From the app, the Super Admin connects Google Drive (Settings → Connect Google Drive).
