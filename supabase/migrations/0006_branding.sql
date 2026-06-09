-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_branding.sql
-- Singleton table for company branding (company name, brand colors, logo URL).
-- Plus a public Storage bucket where the logo image itself lives.
--
-- Read: any authenticated user (every screen reads branding to render).
-- Write: only super_admin (enforced both at RLS AND at the BFF).
--
-- Storage bucket is `public: true` so the unauthenticated /login page can
-- render the logo without a signed URL. Uploads go through the BFF's
-- service-role client (which bypasses RLS), so no insert/update/delete
-- policy on storage.objects is required.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Singleton table. The `id boolean` trick + check constraint guarantees
--    at most one row, matching the pattern used for drive_connection.
create table branding (
  id            boolean primary key default true check (id),
  company_name  text    not null default 'HexaTech Solutions Pvt. Ltd.',
  primary_color text    not null default '#1B2A4A',
  accent_color  text    not null default '#C9A84C',
  logo_url      text,
  updated_at    timestamptz default now(),
  updated_by    uuid references app_users(id)
);

-- 2) Seed the singleton row so GET /api/admin/branding always returns
--    something on a fresh database. Idempotent via the singleton constraint.
insert into branding (id) values (true) on conflict (id) do nothing;

-- 3) RLS.
alter table branding enable row level security;

create policy "Authenticated can read branding"
  on branding for select
  to authenticated
  using (true);

create policy "Super admin can update branding"
  on branding for update
  to authenticated
  using (
    exists (
      select 1 from app_users
      where id = auth.uid()
        and role = 'super_admin'
        and status = 'active'
    )
  );

-- 4) Public Storage bucket for the logo image. 2 MB ceiling, common image
--    formats only. Public read; writes via BFF (service-role).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'branding',
  'branding',
  true,
  2097152,  -- 2 MB
  array['image/png','image/jpeg','image/svg+xml','image/webp']
)
on conflict (id) do nothing;
