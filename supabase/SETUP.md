# HexaTech Vault — Supabase Backend Setup

This is a copy-pasteable checklist to deploy the backend. Nothing here has been
deployed or tested for you (no credentials were available). Follow the steps in
order. Commands assume the `supabase` CLI is installed and you run them from the
project root (the directory that contains this `supabase/` folder).

> Security model recap (Foundation §2): the backend is the ONLY holder of Google
> credentials. Every Drive operation runs: verify JWT → resolve permission from
> our DB → check root-folder scope → perform the Drive call with the company
> token → write an audit row. No Google token is ever sent to the browser.

---

## 0. Prerequisites

- [ ] Install the Supabase CLI: https://supabase.com/docs/guides/cli
- [ ] Install Deno (for local function dev, optional): https://deno.land
- [ ] A Google account that owns the company Google Drive.

---

## 1. Create the Supabase project

- [ ] Create a project at https://supabase.com/dashboard (note the **project ref**, e.g. `abcd1234`).
- [ ] Grab from Project Settings → API: the **Project URL**, **anon key**, **service_role key**.

---

## 2. Google Cloud setup (one-time, by a human) — Foundation §3

- [ ] Create a Google Cloud project at https://console.cloud.google.com
- [ ] Enable the **Google Drive API** (APIs & Services → Library → "Google Drive API" → Enable).
- [ ] Configure the **OAuth consent screen**:
  - Internal if you use Google Workspace (recommended — avoids the 7-day test-app
    refresh-token expiry). Otherwise External + **Publish** the app.
  - Add scope `https://www.googleapis.com/auth/drive` and `.../auth/userinfo.email`.
- [ ] Create an **OAuth 2.0 Client ID** (type: **Web application**):
  - Authorized redirect URI (must match exactly):
    `https://<project-ref>.functions.supabase.co/drive-oauth-callback`
  - Save the **Client ID** and **Client Secret**.

---

## 3. Link the CLI to your project

```bash
supabase login
supabase link --project-ref <project-ref>
```

---

## 4. Set Edge Function secrets

Generate the encryption key and cron secret first:

```bash
# 32-byte AES key (base64) for the refresh token + HMAC state signing:
openssl rand -base64 32        # -> use as TOKEN_ENCRYPTION_KEY
# A long random cron secret:
openssl rand -hex 32           # -> use as CRON_SECRET
```

Then set every secret (see `supabase/.env.example` for the full list):

```bash
supabase secrets set \
  GOOGLE_CLIENT_ID="xxxx.apps.googleusercontent.com" \
  GOOGLE_CLIENT_SECRET="your-google-client-secret" \
  GOOGLE_OAUTH_REDIRECT_URI="https://<project-ref>.functions.supabase.co/drive-oauth-callback" \
  TOKEN_ENCRYPTION_KEY="<base64 32-byte key>" \
  COMPANY_ROOT_NAME="HexaTech Vault" \
  CRON_SECRET="<the cron secret>" \
  APP_REDIRECT_URL="https://your-app-domain/settings"
```

> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are
> injected automatically into deployed functions — you do NOT set them as
> secrets. (For local `supabase functions serve --env-file supabase/.env` you do
> need them in the env file.)

### Required secrets checklist

- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `GOOGLE_OAUTH_REDIRECT_URI`
- [ ] `TOKEN_ENCRYPTION_KEY`  (32-byte; also signs OAuth state)
- [ ] `COMPANY_ROOT_NAME`  (default "HexaTech Vault")
- [ ] `CRON_SECRET`
- [ ] `APP_REDIRECT_URL`
- [ ] (auto) `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

---

## 5. Push the database migrations

```bash
supabase db push
```

This applies, in order:
- `0001_schema.sql` — tables, enums, the singleton `drive_connection`, the
  separate `drive_tokens`/`sync_state` tables, the immutability trigger, indexes.
- `0002_rls_and_functions.sql` — RLS on every table, `get_effective_level()`,
  `is_super_admin()`, and the client-facing SELECT policies.
- `0003_cron.sql` — enables `pg_cron` + `pg_net`, defines `trigger_drive_sync()`,
  and schedules `hourly-drive-sync`.

> If `pg_cron`/`pg_net` are not enabled on your plan, enable them in
> Dashboard → Database → Extensions, then re-run `0003`.

---

## 6. Configure the cron URL + secret (after push)

The cron job reads its target URL and bearer from database settings. Run these
once (replace the placeholders), then reload config:

```sql
alter database postgres set app.sync_url    = 'https://<project-ref>.functions.supabase.co/sync-drive';
alter database postgres set app.cron_secret = '<the same CRON_SECRET you set in step 4>';
select pg_reload_conf();
```

Verify the schedule:

```sql
select jobname, schedule, command from cron.job;             -- should list hourly-drive-sync
select * from cron.job_run_details order by start_time desc; -- after the first hour
```

---

## 7. Deploy the Edge Functions

```bash
supabase functions deploy drive-oauth-start
supabase functions deploy drive-oauth-callback
supabase functions deploy connection-status
supabase functions deploy sync-drive
supabase functions deploy drive-list
supabase functions deploy folder-create
supabase functions deploy drive-upload
supabase functions deploy drive-download
supabase functions deploy drive-delete
supabase functions deploy permissions-get
supabase functions deploy permissions-set
supabase functions deploy assignees-list
supabase functions deploy assignees-add
supabase functions deploy assignees-remove
supabase functions deploy shared-with-me
```

The per-function `verify_jwt` settings live in `supabase/config.toml`
(`drive-oauth-callback` and `sync-drive` have `verify_jwt = false` by design).

---

## 8. Create the auth users (must match seed UUIDs)

`app_users.id` references `auth.users(id)`. Create one Supabase Auth user per
demo user with the EXACT UUID and email from `supabase/seed.sql`.

Easiest via SQL in the Dashboard SQL editor (sets a temporary password; users
can reset it). Repeat per user, matching the table in `seed.sql`:

```sql
-- Example for Zara Ahmed (super_admin). Repeat for all 6 with their own UUID/email.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at)
values ('u0000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'zara@hexatech.io',
        crypt('ChangeMe!123', gen_salt('bf')),
        now(), now(), now());
```

> Alternatively use the Admin API / `supabase.auth.admin.createUser({ user_id, email, password })`
> with `user_id` set to the seed UUID. The key requirement: the auth user id ==
> the app_user id, and the email matches.

Then load the app-side rows:

```bash
supabase db execute --file supabase/seed.sql
# or paste seed.sql into the SQL editor
```

(If you created the auth users via SQL above, run `seed.sql` AFTER, so the FK
to `auth.users` is satisfied.)

---

## 9. Connect Google Drive (one-time, by the super admin)

- [ ] Log into the app as the super_admin (Zara).
- [ ] Settings → "Connect Google Drive" → calls `drive-oauth-start` → redirected
      to Google consent → on success, `drive-oauth-callback` stores the encrypted
      refresh token, creates/links the "HexaTech Vault" root folder, and redirects
      back with `?drive=connected`.
- [ ] The connection is now **permanent** — there is no disconnect/reconnect path.

---

## 10. First sync

- [ ] Either wait for the top-of-hour cron, or trigger manually as super_admin:
  ```bash
  # As the scheduler (service-to-service):
  curl -X POST "https://<project-ref>.functions.supabase.co/sync-drive" \
       -H "Authorization: Bearer <CRON_SECRET>"
  ```
- [ ] Check `select * from sync_runs order by started_at desc;` for a `success` row.

---

## Verification checklist (acceptance criteria across items 01–06)

- [ ] Non-super-admin gets `403` from `drive-oauth-start`.
- [ ] A second connection attempt returns `409`.
- [ ] `update drive_connection set status='x';` and `delete from drive_connection;`
      both raise a DB error (immutability trigger).
- [ ] Browser never receives a Google token (inspect network — only DTOs).
- [ ] `select get_effective_level('<user>','<folder>');` returns the right level
      per Foundation §6.
- [ ] A fileId outside the root → `403 "Outside company root"` from any Drive function.
- [ ] Each privileged action writes an `audit_log` row.

---

## Notes / known limitations

- **Large-file upload is a TODO.** `drive-upload` does a multipart upload for
  small base64 content (and metadata-only when no content is sent). True
  resumable upload for large files is not implemented — see the TODO in
  `functions/_shared/google.ts` (`uploadSmallFile`) and `functions/drive-upload`.
- **Downloads** return Drive `webViewLink`/`webContentLink`, not proxied bytes.
- This package has **not been deployed or run** — treat the first deploy as the
  first real test and watch the function logs.
