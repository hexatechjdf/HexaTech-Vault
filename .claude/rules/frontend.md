# Frontend rules — Next.js + React in this project

Apply when touching anything under `app/` (except `app/api/`), `components/`, or `lib/` files used by the browser bundle.

## Component model

- **Every feature component is `"use client"`.** They use `useState`/`useEffect` heavily. Add the directive on line 1 of any new `.tsx` that uses hooks, event handlers, or browser-only APIs.
- **Server components only for things that don't need interactivity** (e.g. top-level page wrappers that just render a client component or do an initial server fetch). Don't reach for Server Components prematurely — the cost is debugging boundary errors.
- **Inline styles + lucide-react are the established pattern** for feature components (`FileManager`, `FolderAccessControl`, `Settings`, etc.). Don't migrate them to shadcn primitives without a specific reason.
- **`components/ui/*` shadcn primitives exist and are imported** by no feature component today. Use them for new shadcn-based components; don't refactor existing ones.

## Data access — never call Supabase or `fetch()` directly from a component

There are **two parallel data layers**. Pick the right one for the data you need:

### 1. `Backend` abstraction — Drive-touching operations

Use for anything that ultimately calls Google Drive (list folder, upload/download/delete file, create folder, grant folder permission).

```ts
import { getBackend } from "@/lib/backend";

const backend = useMemo(() => getBackend(), []);
const folders = await backend.list(folderId);
```

`getBackend()` returns `MockBackend` in mock mode and `SupabaseBackend` in supabase mode. Adding a new Drive-touching operation = add a method to [`lib/backend/contract.ts`](../../lib/backend/contract.ts) + implement in both. This is the seam that lets the app run fully without Supabase.

### 2. TanStack React Query — BFF-routed data

Use for everything that comes from the Next.js BFF (`/api/admin/*`, `/api/me/*`): users, audit, branding, backup, tab permissions, effective access, profile, etc. Hooks live in [`lib/queries/`](../../lib/queries/), **one file per feature**.

Provider in [`app/providers.tsx`](../../app/providers.tsx) sets defaults: `staleTime: 60_000`, `refetchOnWindowFocus: false`, `retry: 1`. Override per-query when you need different behaviour (e.g. `useUsers` uses `staleTime: 0` + `refetchOnMount: "always"` because permission chips need to reflect grant changes made on Folder Access Control / Tab Access Control without a manual refresh).

**Pattern to follow** (mirrors [`lib/queries/users.ts`](../../lib/queries/users.ts)):

```ts
// 1. Query keys — single source of truth. Use the const everywhere; never
//    inline strings or invalidations silently desync.
export const fooQueryKeys = {
  list: ["foo"] as const,
  one: (id: string) => ["foo", id] as const,
};

// 2. Fetch helpers — small async functions, no React, throw on non-2xx.
async function asJson<T>(res: Response, fallbackMsg: string): Promise<T> {
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string })?.error ?? `${fallbackMsg} (${res.status})`);
  return data as T;
}

async function fetchFoos(): Promise<Foo[]> {
  const res = await fetch("/api/admin/foo", { cache: "no-store" });
  const data = await asJson<{ foos: Foo[] }>(res, "Failed to load foos");
  return data.foos;
}

// 3. Hooks — what components import.
export function useFoos() {
  return useQuery({ queryKey: fooQueryKeys.list, queryFn: fetchFoos });
}

// 4. Mutations — invalidate the relevant query key on success.
export function useUpdateFoo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateFooInput) => patchFoo(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: fooQueryKeys.list }),
  });
}
```

**For PATCH endpoints with multiple actions** (like `/api/admin/users/[id]`), use a single `patch<Resource>(id, body)` helper and dispatch on a `body.action` discriminator. See `useUpdateUserProfile` / `useUpdateUserRole` / `useResetUserPassword` in `lib/queries/users.ts`.

### Which layer for new work?

- Drive-touching? → extend `Backend`, then add a Query hook that wraps it (so the UI gets caching + invalidation).
- BFF-only? → add the route under `app/api/`, then add the hook in `lib/queries/`.
- **Never** call `fetch("/api/...")` from a component directly — write the hook. Same review-rejection rule applies to BFF data as to Supabase data.

## Auth in components

```ts
import { useAuth } from "@/lib/auth";

const { user, loading, logout } = useAuth();
```

- Guard against `loading` and `!user` before using `user.*`.
- For UI capability checks: `capabilities(level)` returns `{ canView, canDownload, canUpload, canRename, canMove, canDelete, canCreateSubfolder, canManageAccess }`. Use this — do NOT inline role/perm-level logic.
- The UI capability check is **UX-only**. The server (Edge Function or BFF) re-checks. Never assume client checks are sufficient.

## Routing

- File-based App Router. New screen → new folder under `app/(app)/<segment>/page.tsx`.
- Navigation in client code → `useRouter()` from `next/navigation`. Don't import from `next/router` (pages router).
- Active-tab/segment → `useSelectedLayoutSegment()` or `usePathname()`.
- `Layout` is rendered in `app/(app)/layout.tsx` — don't re-render it inside pages.

## Styling

- Tailwind 4 is configured (`tailwind.config.ts` + `@tailwindcss/postcss`). New components MAY use Tailwind utility classes.
- Existing feature components use inline styles with `'Poppins', sans-serif`, the gold (`#C9A84C`) and navy (`#1B2A4A`) brand colours. Match that vocabulary for cohesion.
- Don't add new global CSS to `app/globals.css` without a reason — prefer component-local styles.

## Side-effect discipline

- Don't fire data fetches in render. Use `useEffect` or move to a server component.
- Don't put `useState` calls inside `.map()` / loops (rules of hooks). If you need per-row state, extract a child component (see `UserManagement.tsx`'s `FolderAccessRow` pattern).
- Always include a stable dep array in `useEffect`. Add `// eslint-disable-next-line react-hooks/exhaustive-deps` only when the linter is wrong AND leave a one-line comment why.

## Error handling

- Async actions in components: wrap in try/catch and surface via `toast.error(...)` from `sonner`. Don't `throw` past the boundary.
- `PermissionError` from `@/lib/backend` means "blocked by permission" — show its message; everything else gets a generic toast.

## SSR safety

- Anything that touches `window`, `localStorage`, or `navigator` must be guarded with `typeof window !== "undefined"` or moved inside `useEffect`. The `MockBackend` already wraps localStorage this way — match the pattern.

## File / import conventions

- `@/lib/...`, `@/components/...` (configured in `tsconfig.json`).
- Types from `@/lib/types`; engine helpers from `@/lib/permissions`; backend from `@/lib/backend`.
- Group imports: external (`react`, `next/...`, `lucide-react`, `sonner`) → `@/lib/...` → `@/components/...` → relative.

## Common gotchas

- **Path alias not resolving** → check `tsconfig.json` `"paths"` and that the file is under the alias root.
- **`localStorage is not defined`** during build → you're calling it outside a client component or outside `useEffect`.
- **Hydration mismatch** → don't use `Date.now()` / `Math.random()` / locale-dependent formatting in render. Compute in `useEffect`.
- **`useRouter is not a function`** → wrong import; should be `next/navigation`, not `next/router`.
