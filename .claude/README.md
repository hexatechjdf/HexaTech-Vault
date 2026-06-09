# `.claude/` — Claude Code configuration for this project

This directory configures how Claude Code behaves when working in `next-app/`.
It is checked into git **except** `settings.local.json`, which is per-developer.

## Files

| File | Purpose | Git |
|---|---|---|
| `settings.json` | Project defaults — model, allow/deny permissions, hooks. Applies to everyone. | ✅ tracked |
| `settings.local.json` | Your personal overrides (e.g. different model, extra permissions). | ❌ gitignored |
| `rules/*.md` | Path-scoped engineering rules. Claude loads the relevant one when working in that area. | ✅ tracked |
| `skills/<name>/SKILL.md` | Reusable workflows invoked via `/<name>` (e.g. `/deploy`). | ✅ tracked |

## Rules — what's where

| File | Applies when working on… |
|---|---|
| [`rules/frontend.md`](rules/frontend.md) | `app/`, `components/`, `lib/auth.tsx`, `lib/backend/mockBackend.ts` (UI + client code) |
| [`rules/api.md`](rules/api.md) | `app/api/**`, server actions, anything calling `lib/supabase/{server,admin}.ts` |
| [`rules/database.md`](rules/database.md) | `supabase/migrations/*`, RLS policies, schema changes, SQL functions |
| [`rules/permissions.md`](rules/permissions.md) | **CRITICAL** — `lib/permissions.ts` and its SQL twin. Read before changing either. |
| [`rules/security.md`](rules/security.md) | The do-not-do list. Read before touching auth, tokens, env, Drive scope. |
| [`rules/testing.md`](rules/testing.md) | Adding or changing tests. |

## Skills — what's there

| Command | What it does |
|---|---|
| `/deploy` | End-to-end deploy checklist for Next.js + Supabase + Edge Functions. |
| `/add-edge-function` | Scaffold a new Supabase Edge Function that matches the project's conventions (auth → permission → root-scope → action → audit). |
| `/add-permission-level` | Add a new `perm_level` consistently — TS matrix **and** SQL function get updated together. |

## How to customise

- **Change the default model** → edit `settings.json` `"model"`, or override personally in `settings.local.json`.
- **Add a permission** that should auto-allow without prompting → add to `settings.json` `"permissions"."allow"` using the [`Tool(arg-pattern)`](https://docs.claude.com/claude-code/settings) syntax (e.g. `"Bash(npm run *)"`).
- **Add a hook** (shell command on Claude tool events) → add to `settings.json` `"hooks"`. Keep them cheap — they run frequently.
- **Add a rule** → drop a `.md` in `rules/` and reference it from this README. Keep rules focused (~50–150 lines each).
- **Add a skill** → create `skills/<slug>/SKILL.md` with frontmatter `name: <slug>` + a description and a step-by-step workflow.

## Conventions

- Rules and skills are **prescriptive**, not exhaustive — they say *what to do* in this project, not *how to use Claude Code*.
- Don't put secrets in any of these files. They go in `.env.local` (gitignored, and also blocked by `settings.json` deny).
- Don't include behaviour-shaping content here that belongs in `../CLAUDE.md`. CLAUDE.md is the "always-loaded brain"; rules are path-scoped specifics.
