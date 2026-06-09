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
