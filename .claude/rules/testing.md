# Testing rules

Apply when adding tests, changing test infrastructure, or being asked to verify behaviour.

## Current state — be honest about this

**There are no tests in this repo yet.** No `vitest`, no `jest`, no `playwright` set up. Before claiming "this is tested" or "the tests pass", check that any test infrastructure actually exists.

When asked to "verify" or "test" something today, that means:
1. `npm run build` (Next.js typecheck + compile).
2. `npm run lint` if eslint is configured.
3. Manual UI exercise via `npm run dev` (mock mode runs without Supabase).

## Recommended stack when tests are added

| Layer | Tool | Why |
|---|---|---|
| Unit | **Vitest** | Fast, ESM-native, plays well with Vite/Next, drop-in for Jest API. |
| Component | **@testing-library/react** | Testing user-visible behaviour, not implementation. |
| E2E | **Playwright** | Multi-browser, robust auto-waits, real cookies (matches the Supabase cookie flow). |
| SQL | **pgTAP** or **`supabase test db`** | Test `get_effective_level()` and RLS policies against a real Postgres. |

Install with deny-aware commands; settings.json already allows `npm install*` and `npx playwright*`.

## What to test first (highest value)

1. **`lib/permissions.ts` — the capability matrix.** The most important code in the project. Unit-test every `(level, capability)` pair and every documented resolution case in [`rules/permissions.md`](permissions.md).
2. **`get_effective_level()` (SQL).** Same cases, run via pgTAP. If TS and SQL disagree, that's a bug.
3. **BFF auth guards.** For each `app/api/**/route.ts`, test: unauthenticated → 401, signed-in non-super-admin → 403 (for admin routes), valid super_admin → 200.
4. **`MockBackend` behaviour.** It's used by every developer and demo. Cover the same scenarios the real backend would: create folder rolls back on failure, no-escalation in grants, shared-with-me filters to other departments.
5. **Login flow** (once implemented) — E2E with Playwright against a local Supabase. Real cookies, real `signInWithPassword`.

## Patterns to follow

- **Test behaviour, not internals.** A test that calls a private method or asserts on `useState` values is a refactor blocker.
- **No snapshots for UI** — they rot and get blindly updated. Use explicit assertions on visible text/roles.
- **One file per module** under test (e.g. `lib/permissions.test.ts` next to `lib/permissions.ts`).
- **Name tests as user stories.** `"super_admin can delete any folder"` > `"effectiveLevel returns full_control"`.
- **Reset state between tests.** For `MockBackend` tests, clear the localStorage key in `beforeEach`.
- **Don't network in unit tests.** Mock `fetch` for `SupabaseBackend` tests.

## E2E specifics

- Use the Supabase local stack (`supabase start`) for E2E. Real Postgres, real Edge Functions.
- Each test creates its own user via the admin client (or reuses a fixture).
- Don't share cookies between tests.

## What NOT to do

- ❌ **Don't claim something is tested when no test file exists.** Check before saying it.
- ❌ **Don't add `// @ts-expect-error` to make a test compile.** Fix the type or the test.
- ❌ **Don't test the Supabase library itself** — assume `signInWithPassword` works. Test our usage of it.
- ❌ **Don't write a test that requires production credentials.** Use the local stack.
- ❌ **Don't mock what you don't own.** If you need to mock RLS to test a component, you're testing at the wrong layer.

## Coverage thresholds — none yet

We don't enforce coverage. The goal is **meaningful tests on critical paths**, not a high number. The permission engine should be at 100%; UI styling tests are worth zero.
