# Permission rules — the single most important invariant

**This is the highest-value file in this project.** Authorization correctness depends on it. Read it before changing anything in `lib/permissions.ts`, `supabase/migrations/0002_rls_and_functions.sql`, `supabase/migrations/0018_user_wins_permission_engine.sql`, or anywhere that resolves "can user X do Y on folder Z".

## The model in one paragraph

A user's effective permission level on a folder is resolved by walking the folder's ancestor chain (nearest first) and applying **user-wins** semantics at each node: if a personal user grant exists for the caller it returns that level (even `no_access`), otherwise a matching role grant returns its level, otherwise we climb to the parent. Grants apply to **users** and **roles** only (departments were removed in migration `0015`). Grants live in `permission_grants` keyed by `(folder_id, principal_type, principal_id)`. The level maps to a fixed set of capabilities via the matrix in `lib/permissions.ts`. **`super_admin` is always `full_control` everywhere** (hardcoded short-circuit). The matrix is mirrored in SQL as `get_effective_level()` (migration `0018`); RLS policies and Edge Functions call it.

## The capability matrix (source of truth)

`lib/permissions.ts` exports:

```ts
PERM_LEVELS: PermLevel[]                  // ordering still matters for level rank (UI)
PERM_LABELS: Record<PermLevel, string>    // for UI
PERM_COLORS: Record<PermLevel, string>    // for UI
CAPABILITIES: Record<PermLevel, Capabilities>
capabilities(level): Capabilities
maxLevel(a, b): PermLevel                 // pick the stronger (used for grant clamping, not resolution)
can(level, capability): boolean
```

Current levels (low → high): `no_access`, `view`, `view_download`, `view_upload`, `contributor`, `full_control`.

Capabilities (boolean flags): `canView`, `canDownload`, `canUpload`, `canRename`, `canMove`, `canCreateSubfolder`, `canManageAccess`.

> **Note:** `canDelete` was removed from the matrix. Delete is now a hardcoded **super_admin-only** action — it lives outside the permission system entirely. See `drive-delete` Edge Function and `FileManager` UI gates.

## The two-sided rule

The matrix lives in **two places** that must agree byte-for-byte in meaning:

| Side | File | What's there |
|---|---|---|
| TS | [`lib/permissions.ts`](../../lib/permissions.ts) | `PERM_LEVELS`, `CAPABILITIES`, helpers used by client + mock backend. |
| SQL | [`supabase/migrations/0002_rls_and_functions.sql`](../../supabase/migrations/0002_rls_and_functions.sql) + [`supabase/migrations/0018_user_wins_permission_engine.sql`](../../supabase/migrations/0018_user_wins_permission_engine.sql) | `perm_level` enum (0002), `get_effective_level()` function (rewritten in 0018 to user-wins), RLS policies (0002). |

**Never change one without changing the other in the same commit.** Use the [`/add-permission-level`](../skills/add-permission-level/SKILL.md) skill — it walks both sides.

## Resolution algorithm — USER-WINS (must match in TS and SQL)

```
function effectiveLevel(user, folderId):
    if user.role == 'super_admin':
        return 'full_control'

    for node in ancestors(folderId):           # nearest first, root last

        # 1. Personal user grant takes precedence over EVERYTHING else at this
        #    node, including no_access (explicit revocation).
        userGrant = grants.find(folder_id = node.id,
                                principal_type = 'user',
                                principal_id  = user.id,
                                expires_at    = null OR > now())
        if userGrant:
            return userGrant.level

        # 2. Role grant applies when no personal grant exists at this node.
        roleGrant = grants.find(folder_id = node.id,
                                principal_type = 'role',
                                principal_id  = user.role,
                                expires_at    = null OR > now())
        if roleGrant:
            return roleGrant.level

        # 3. Otherwise climb to the parent.

    return 'no_access'                          # No ancestor had any applicable grant.
```

## Worked examples

These are the canonical test cases. The engine must produce these results.

| Setup | Alice's role | Resolves to | Why |
|---|---|---|---|
| Role grant `team_member`=`view` on /M, no user grant | team_member | `view` | Role applies |
| Role grant `team_member`=`view` on /M, user grant Alice=`contributor` on /M | team_member | `contributor` | User wins over role |
| Role grant `team_member`=`contributor` on /M, user grant Alice=`no_access` on /M | team_member | `no_access` | User wins; explicit revocation |
| User grant Alice=`contributor` on /M, no grant on /M/Q4 | team_member | `contributor` (inherited from /M) | Nearest ancestor with a grant decides |
| User grant Alice=`contributor` on /M, role grant `team_member`=`view` on /M/Q4 | team_member | `view` | Q4 grant overrides ancestor's grant (nearest wins) |
| No grants anywhere on the chain | team_member | `no_access` | No applicable grant |
| Alice is super_admin | super_admin | `full_control` | Short-circuit |

## File permissions

Files have **no grants of their own**. A file's effective level = the effective level on its parent folder. So granting access to a folder automatically grants access to every file inside it (recursively, via folder inheritance).

This is enforced by:
- `toFileDTO()` in `_shared/dto.ts` — sets `file.myLevel` from `getEffectiveLevel(user, file.folder_id)`.
- `drive-download` / `drive-upload` / `drive-delete` Edge Functions — call `requirePermission(user, folder_id, capability)`.

## Enforcement layers (defence in depth)

A request to do *X* on folder *F* by user *U* passes through these checks:

1. **UI** (`capabilities(level).canX`) — convenience only. Hides buttons. **Never sufficient on its own.**
2. **Backend method** (`MockBackend.require(folderId, "canX")` or the BFF route) — same matrix, server-evaluated.
3. **Edge Function** (`requirePermission(userId, folderId, "X")`) — same matrix, Postgres-evaluated via `get_effective_level()`.
4. **RLS policy** — Postgres re-checks before returning rows. The last line of defence.

If you skip layer 3 or 4, you have a hole. If layers 1–4 disagree, you have a bug.

## Drive sharing — what mirrors and what doesn't

| Grant type | App enforcement | Drive sharing |
|---|---|---|
| **User grant** | `permission_grants` row resolved by `get_effective_level()` | Mirrored automatically by `permissions-set` Edge Function via `addDrivePermission()`. The Drive share is stored in `permission_grants.drive_permission_id`. |
| **Role grant** | Same engine | Fanned out to individual Drive shares — one per active user matching the role (see migration `0019` and `role_grant_drive_shares` table). When users join/leave the role or the grant changes, the fan-out is reconciled. |

Both grant types are visible inside the app immediately; the Drive side is synchronised by the Edge Function. Super Admin (who owns the Drive) sees and can access everything regardless.

## Common mistakes to avoid

- ❌ **Hard-coding role checks in components** (`if (user.role === "team_lead") ...`). Use `capabilities(level)` against the resolved level. The only legitimate hardcoded role check is `super_admin` for system-level actions (delete, manage Drive, etc.).
- ❌ **Using `level !== "no_access"` as a proxy for canView**. It happens to be true today, but `capabilities(level).canView` is the contract.
- ❌ **Adding a level without updating the SQL enum order**. The enum order = the level ranking. Out-of-order = wrong `maxLevel` results (used in places like grant clamping).
- ❌ **Granting a level above the granter's own** without a `super_admin` check. The mock backend clamps; the Edge Functions must too.
- ❌ **Treating "no grant for me at this node" as `no_access` and returning early**. The engine MUST climb to the parent. Only "no applicable grant at any ancestor" resolves to `no_access`.
- ❌ **Adding department grants back in**. The principal type is `'user' | 'role'` only. Departments were removed in migration `0015` and the engine no longer considers them.

## Testing the engine

The engine should be the most heavily tested piece of TS code in this project. See [`rules/testing.md`](testing.md). Required cases (taken from the worked-examples table above):

- super_admin always returns `full_control`
- user grant beats role grant at the same node (both directions: higher level AND no_access revocation)
- nearest folder with any grant wins over ancestor grants
- expired grants are ignored
- `no_access` user grant on a child overrides a stronger ancestor role grant
- no applicable grant anywhere → `no_access`
- non-applicable principal grants are skipped (different user id, different role)

---

# Tab Permission System (separate from folder permissions)

The folder permission engine above governs **access to data inside the Drive**. The tab permission engine described below governs **access to the application's UI surfaces** — User Management, Folder Access Control, File Manager, Audit Logs, Storage Overview, Settings. The two engines are intentionally separate so admins never confuse "this user can see file X" with "this user can use the Audit Logs page."

## The model in one paragraph

A user's effective level for a given tab is resolved by the same user-wins / role-dept / role-unscoped precedence the folder engine uses, **but without ancestor walking** (tabs are a flat list, not a tree). Grants live in `tab_permission_grants` keyed by `(tab, principal_type, principal_id, principal_dept_id)`. The level maps to one of three values: `no_access`, `view`, `action`. `super_admin` short-circuits to `action` on every tab.

## The 6 tabs (registry)

| Tab key | Display name | Route |
|---|---|---|
| `user_management` | User Management | `/users` |
| `folder_access` | Folder Access Control | `/folders` |
| `file_manager` | File Manager | `/files` |
| `audit_logs` | Audit Logs | `/audit` |
| `storage_overview` | Storage Overview | `/storage` |
| `settings` | Settings | `/settings` |

Dashboard (`/dashboard`) and Profile (`/profile`) are NOT in the registry — Dashboard is always visible (it's the post-login landing), Profile is per-user own-data and needs no grant. **The Tab Access Control screen itself is super-admin-only** by hardcoded check (not by tab grant), so the bootstrap problem of "who grants the right to grant tab access" never arises.

## The three levels

| Level | Nav | Inside the tab |
|---|---|---|
| `no_access` | Tab hidden from nav. Typing the URL → redirect to /dashboard. | n/a |
| `view` | Tab visible. Page renders. All data loads. | Action buttons / forms are disabled. Read-only mode. |
| `action` | Tab visible. Page renders. All data loads. | Full ability — create, edit, delete, etc. |

`no_access` is the **default** when no grant matches — there's no row required to express "no access."

## Schema (migration 0026)

```sql
-- Enum: the 6 tabs the system permissions cover.
create type tab_name as enum (
  'user_management',
  'folder_access',
  'file_manager',
  'audit_logs',
  'storage_overview',
  'settings'
);

-- Enum: the 3 effective levels for a tab.
create type tab_level as enum (
  'no_access',
  'view',
  'action'
);

-- Grants table. Mirrors permission_grants for folders but flat (no folder_id /
-- tree walk). principal_dept_id semantics match folder grants exactly.
create table tab_permission_grants (
  id                 uuid primary key default gen_random_uuid(),
  tab                tab_name not null,
  principal_type     text not null check (principal_type in ('user', 'role')),
  principal_id       text not null,          -- user uuid (text) OR role name
  principal_dept_id  uuid references departments(id) on delete cascade,
  level              tab_level not null,
  granted_by         uuid references app_users(id),
  granted_at         timestamptz not null default now(),
  -- A user grant is per-individual; department scope is meaningless.
  check (principal_type <> 'user' or principal_dept_id is null),
  -- Same (folder, type, id, coalesce(dept, sentinel)) idea as folder grants.
  unique (tab, principal_type, principal_id, coalesce(principal_dept_id, '00000000-0000-0000-0000-000000000000'::uuid))
);

create index idx_tab_grants_role_dept
  on tab_permission_grants (tab, principal_type, principal_id, principal_dept_id)
  where principal_type = 'role';
```

## Engine

```sql
create or replace function get_effective_tab_level(p_user uuid, p_tab tab_name)
returns tab_level
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_role        text;
  v_dept        uuid;
  v_user_level  tab_level;
  v_role_level  tab_level;
begin
  if p_user is null or p_tab is null then return 'no_access'; end if;

  -- Super Admin short-circuit.
  if is_super_admin(p_user) then return 'action'; end if;

  select role::text, department_id into v_role, v_dept
  from app_users where id = p_user;

  -- 1. Personal user grant always wins.
  select level into v_user_level
  from tab_permission_grants
  where tab = p_tab
    and principal_type = 'user'
    and principal_id = p_user::text
  limit 1;
  if v_user_level is not null then return v_user_level; end if;

  -- 2. Role + caller's department.
  if v_dept is not null then
    select level into v_role_level
    from tab_permission_grants
    where tab = p_tab
      and principal_type = 'role'
      and principal_id = v_role
      and principal_dept_id = v_dept
    limit 1;
    if v_role_level is not null then return v_role_level; end if;
  end if;

  -- 3. Unscoped role grant.
  select level into v_role_level
  from tab_permission_grants
  where tab = p_tab
    and principal_type = 'role'
    and principal_id = v_role
    and principal_dept_id is null
  limit 1;
  if v_role_level is not null then return v_role_level; end if;

  return 'no_access';
end;
$$;
```

## Worked examples (canonical test cases)

| Setup | Caller | Resolves to | Why |
|---|---|---|---|
| Role grant `team_lead@CRM = action` on `folder_access` | team_lead in CRM | `action` | Role+dept matches |
| Same grant | team_lead in WordPress | `no_access` | Role matches but dept doesn't, no unscoped role grant, no user grant |
| Role grant `team_lead@CRM = action`, user grant Alice = `view` | Alice (team_lead in CRM) | `view` | User-wins |
| Role grant unscoped `team_lead = view`, role+dept `team_lead@CRM = action` | team_lead in CRM | `action` | Role+dept beats unscoped |
| No grants for caller | anyone | `no_access` | Default |
| Caller is super_admin | super_admin | `action` | Hardcoded |

## Enforcement layers (defence in depth)

1. **Nav rendering** (`Layout.tsx`) — hide nav items where caller's level is `no_access`. UX only.
2. **Route gate** (`middleware.ts`) — redirect `no_access` users to `/dashboard` when they try to type a forbidden URL.
3. **Page-level fetch** — every tab's data fetch must call `requireTabLevel(userId, tab, 'view')` server-side before returning data.
4. **Action gate** — every mutation endpoint must call `requireTabLevel(userId, tab, 'action')`. UI buttons / forms also disabled by level on the client, but that's UX, not security.

If layer 4 is skipped, you have a hole. Layers 1 + 2 + 3 + 4 together must agree.

## What the UI surface looks like

A new **Tab Access Control** screen (super_admin only, route `/tabs`) mirrors `FolderAccessControl`:

- Left rail: principal picker (Users / Roles tabs, dept scope for roles).
- Right pane: the 6 tabs listed, each with a `No Access / View / View + Action` dropdown.
- Same loader/spinner UX as Folder Access Control.

A new **User Profile (effective access)** view, reachable from Folder Access Control (Users tab → user picked) AND from User Management (row → "View Access"), shows:

- A "Folder permissions" section with two badge-distinguished groups: **Inherited via Role + Department** and **Direct User Grants**.
- A "Tab permissions" section with the same two groups.

## Things to NEVER do (tab side)

- ❌ **Hide a button purely client-side** when a mutation matters. Always re-check on the BFF / Edge Function.
- ❌ **Use route gating alone** for sensitive pages. Always pair with server-side `requireTabLevel`.
- ❌ **Add a tab without registering it in the enum** (and the corresponding TS constant). The two sides must agree.
- ❌ **Grant a tab level to the `super_admin` role** — super_admin already has `action` on every tab via short-circuit. Such a row is a no-op at best.

## Baseline tab defaults (migration 0027)

Every non-super-admin role gets `file_manager: action` by default — installed once via [`supabase/migrations/0027_default_file_manager_access.sql`](../../supabase/migrations/0027_default_file_manager_access.sql) as five unscoped role grants:

```
(file_manager, role, admin,        NULL, action)
(file_manager, role, manager,      NULL, action)
(file_manager, role, team_lead,    NULL, action)
(file_manager, role, lead_dev,     NULL, action)
(file_manager, role, team_member,  NULL, action)
```

Rationale: File Manager IS the product. Without it, the user can't use Drive folders, and asking the Super Admin to grant File Manager access to every new user one-by-one is busywork. Every other tab (User Management, Folder Access Control, Audit Logs, Storage Overview, Settings) remains opt-in by the Super Admin.

The user-wins rule still applies: if the Super Admin wants to restrict a specific user (say, set Alice to `view` or `no_access`), the per-user grant overrides the role grant. The Tab Access Control screen is the place to do this.

Super_admin is intentionally NOT in this baseline — they always short-circuit to `action`, so a grant would be a no-op. The Edge Function `tab-permissions-set` actively rejects grants targeting `super_admin`.
