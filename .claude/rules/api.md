# API rules — Route Handlers + Server Actions (the BFF)

Apply when touching anything under `app/api/`, server actions (files ending in `actions.ts` or marked `"use server"`), `middleware.ts`, or `lib/supabase/{server,admin}.ts`.

## What the BFF is for

This Next.js BFF handles:
- **Authentication** (login, logout, session refresh) via `@supabase/ssr` cookies.
- **Admin operations that need the service-role key** (creating users, etc.).
- **Anything Next-side** that can't live in the browser (e.g. SSR data fetching, cookie reads).

**What it is NOT for:**
- ❌ Drive operations — those live in `supabase/functions/` Edge Functions.
- ❌ Permission/grant CRUD against Drive-touching resources — same, Edge Functions.
- ❌ Any general-purpose API. We are using Supabase as the database; talk to it directly via the Edge Functions or via `SupabaseBackend`.

## Two Supabase clients — know which to use

| Client | File | Key | Use for |
|---|---|---|---|
| Browser | [`lib/supabase/client.ts`](../../lib/supabase/client.ts) | `anon` (public) | Client components needing direct Supabase reads (rare — prefer `Backend`). |
| Server (user-scoped) | [`lib/supabase/server.ts`](../../lib/supabase/server.ts) | `anon` + user cookie | Anything in server actions / route handlers that should respect RLS as the **current user**. |
| Server (admin) | [`lib/supabase/admin.ts`](../../lib/supabase/admin.ts) | `service_role` (**secret**) | Admin operations that need to bypass RLS (creating users, system tasks). **NEVER** import from a `"use client"` file. |

If a route handler needs both (read as user, then mutate as admin), import both — but never expose either result back to the browser without sanitising.

## Auth check pattern (every protected route)

```ts
// app/api/admin/users/route.ts (planned shape)
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin"; // SERVER ONLY
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  // 1. Who is calling? Use the user-scoped client (cookie-based).
  const supabase = createSupabaseServerClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();
  if (!authUser) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // 2. Load the app_user (role / department).
  const { data: profile } = await supabase
    .from("app_users").select("id, role, department_id, status").eq("id", authUser.id).single();
  if (!profile || profile.status !== "active") {
    return NextResponse.json({ error: "Account inactive" }, { status: 403 });
  }
  if (profile.role !== "super_admin") {
    return NextResponse.json({ error: "Super admin only" }, { status: 403 });
  }

  // 3. Validate the body BEFORE touching anything privileged.
  const body = await req.json().catch(() => ({}));
  // …validate every field…

  // 4. Use the admin client only for what needs it.
  const admin = supabaseAdmin();
  // …admin op + audit log…

  return NextResponse.json({ ok: true, /* … */ });
}
```

## Server Actions vs Route Handlers

| Pattern | When |
|---|---|
| **Server Action** (form `action={...}`) | Form submissions, redirects after success, anything that benefits from progressive enhancement. Login uses this. |
| **Route Handler** (`route.ts`) | Programmatic JSON APIs, calls from third-party clients, anything the UI fetches with `fetch()`. Admin user creation uses this (UI fetches it). |

## Response conventions

- Success: `NextResponse.json({ ok: true, ...payload })` with `status: 200` (default) or `201` for creates.
- Failure: `NextResponse.json({ error: "<short user-safe message>" }, { status: 4xx or 5xx })`.
- Never leak internal error details (database column names, stack traces, tokens).
- Status codes: `401` (no/expired session), `403` (signed in but not allowed), `404` (target not found OR you don't want to confirm existence), `409` (state conflict, e.g. duplicate email), `422` (validation), `500` (server error you couldn't recover).

## Audit-log every privileged action

When the BFF performs a write (creating a user, changing a permission), insert a row into `audit_log` using the admin client. Never skip it for convenience.

```ts
await admin.from("audit_log").insert({
  actor_id: profile.id,
  action: "admin.user_invite",
  resource_type: "user",
  resource_id: createdUser.id,
  details: { email, role, department_id },
  result: "success",
});
```

## Validation

- Validate every body field. Type-narrow before use.
- Validate **on the server**, even if the client also validated.
- Email format check is not enough — let Supabase reject malformed emails.

## Input/output sanitisation

- Never return a Supabase `data` object verbatim. Whitelist the fields the client should see.
- Never include `auth.users.*` in responses (Supabase Auth internals).

## Middleware (`middleware.ts`)

- Today it only refreshes the cookie (`supabase.auth.getUser()`) — no route gating.
- When login is implemented, add gating here:
  - `(app)/*` without session → redirect `/login`.
  - `/login` with session → redirect `/dashboard`.
  - Role-restricted segments → check `app_users.role`.
- Keep middleware light. It runs on every request.

## What NOT to do

- ❌ Don't put service-role usage inside a `"use client"` import graph. Webpack will happily bundle it and your service-role key ends up in the browser. (Next.js *should* warn for `process.env.SUPABASE_SERVICE_ROLE_KEY`, but don't rely on that alone — keep `lib/supabase/admin.ts` strictly imported from server-only files.)
- ❌ Don't proxy Drive operations through the BFF — call the existing `supabase/functions/` directly via `SupabaseBackend`.
- ❌ Don't add CORS headers unless an external client genuinely needs them. Same-origin Next.js fetches don't.
- ❌ Don't trust the request body's `userId` / `role` / `actorId` — derive identity from the session cookie.
