---
name: add-permission-level
description: Add or rename a permission level (perm_level) consistently. Updates the TS capability matrix AND the SQL function AND the UI labels in one coherent change. Use this WHENEVER you change PERM_LEVELS — never edit one side without the other.
---

# /add-permission-level — Add a permission level without breaking authorization

The capability matrix is the project's most important invariant. It lives in **two places** that must agree:

| Side | File | What's there |
|---|---|---|
| TS | [`lib/permissions.ts`](../../../lib/permissions.ts) | `PERM_LEVELS`, `CAPABILITIES`, `PERM_LABELS`, `PERM_COLORS` |
| SQL | [`../../../supabase/migrations/0002_rls_and_functions.sql`](../../../supabase/migrations/0002_rls_and_functions.sql) | `perm_level` enum, `get_effective_level()` |

This skill enforces the cross-side update. **Don't edit `lib/permissions.ts` directly without going through this skill.**

## Inputs you need before starting

- The new level slug (snake_case, e.g. `editor`, `commenter`).
- Its position in the ranking (between which two existing levels?).
- Its capability flags (which of `canView`, `canDownload`, `canUpload`, `canRename`, `canMove`, `canDelete`, `canCreateSubfolder`, `canManageAccess`).
- Its display label and colour (consistent with the existing palette).
- A short justification — what does this enable that existing levels don't? If you can't answer in one sentence, you probably don't need it.

## Steps

### 1. TS side — `lib/permissions.ts`

1. Add to the `PermLevel` union in [`lib/types.ts`](../../../lib/types.ts).
2. Add to `PERM_LEVELS` array — **in ranking order** (low → high). Order matters; this is used by `RANK` below.
3. Add to `PERM_LABELS` (display string).
4. Add to `PERM_COLORS` (hex; reuse the palette where possible).
5. Add an entry to `CAPABILITIES` with the exact flag combination. Be explicit — no shortcuts like `...CAPABILITIES.view`.
6. Update `RANK` so its order matches `PERM_LEVELS`.

### 2. SQL side — new migration

Create `supabase/migrations/<NNNN>_perm_level_<slug>.sql`. Two operations:

```sql
-- 1) Add the new enum value at the right position.
--    Adjust BEFORE/AFTER to match the TS ranking order EXACTLY.
ALTER TYPE perm_level ADD VALUE IF NOT EXISTS '<slug>' BEFORE '<next_higher_level>';

-- 2) Update get_effective_level() if its logic depends on specific levels (it shouldn't —
--    it returns max(level) and the enum order does the ranking — but verify after migrate).
```

If `get_effective_level()` does ANY level-specific branching, update its body in the same migration.

### 3. RLS policies

Run through the RLS policies in `0002_rls_and_functions.sql`. If any policy uses a specific level (e.g. `level >= 'contributor'`), confirm the new level falls on the correct side of that comparison given the new enum order. Add a migration to tighten/loosen if needed.

### 4. Frontend matrix consumers

Greps to run:

```text
PERM_LEVELS, CAPABILITIES, capabilities(, levelRank(, maxLevel(
```

Any `Object.keys(CAPABILITIES)` / `PERM_LEVELS.map(...)` UI will pick up the new level automatically. Any explicit list of levels (e.g. a dropdown that filters `l !== "no_access"`) needs to consider whether the new level belongs.

### 5. Edge Functions

The shared `_shared/permissions.ts` uses `get_effective_level()` via RPC, so no per-function change is needed. But if any function does a level comparison in its body, audit those too.

### 6. Tests

(Once tests exist — see [`rules/testing.md`](../../rules/testing.md).)

- Add a unit test row for the new `(level, capability)` pair in TS.
- Add the same in pgTAP for the SQL function.
- Add a resolution test: "user with grant of `<slug>` on folder X can/cannot do Y".

### 7. Documentation

Update [`rules/permissions.md`](../../rules/permissions.md) — the level list and any prose that enumerates levels.

If `IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md` §6 explicitly lists the levels, update that too.

### 8. Build + deploy

- `npm run build` in `next-app/` — typecheck catches inconsistent unions.
- Deploy backend first (the SQL enum needs to land before the frontend submits the new level value). Use [`/deploy`](../deploy/SKILL.md).

## What you MUST NOT do

- ❌ Add `'editor'` to the TS union and push without also updating the SQL enum. The next `permissions-set` call from the frontend will fail with `invalid input value for enum perm_level`.
- ❌ Add it to the SQL enum at the wrong position. Enum order = ranking; getting this wrong silently changes `max()` results for everyone.
- ❌ Remove or rename an existing level — that's a separate, much harder operation that requires a data migration. This skill is for additions only.
- ❌ Use `ALTER TYPE perm_level ADD VALUE` without `BEFORE` / `AFTER` — Postgres puts it at the end, which is rarely what you want.

## Output

When done, report:
- TS files touched.
- New migration file path.
- Capability matrix diff (just the new row).
- Build status (`npm run build` ✅/❌).
- Anything that still needs deploying.
