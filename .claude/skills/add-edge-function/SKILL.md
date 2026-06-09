---
name: add-edge-function
description: Scaffold a new Supabase Edge Function (Deno) that matches the project's conventions — auth → permission → root-scope → action → audit. Use whenever adding a new backend endpoint that touches Drive, permissions, folders, files, or any other gated resource.
---

# /add-edge-function — Add a Supabase Edge Function the right way

Use this skill when you need to expose a new backend operation to the frontend. Edge Functions live in `supabase/functions/<name>/index.ts` (relative to this `next-app/`).

## Decide first: does this belong here at all?

| Need | Where it lives |
|---|---|
| Touches Google Drive | ✅ Edge Function |
| Reads/writes `permission_grants`, `folder_assignees`, `folders`, `files` | ✅ Edge Function |
| Auth-gated DB operation that's part of the public API | ✅ Edge Function |
| Login / logout / session / Next-side BFF concern | ❌ Next `app/api/`, not here |
| Admin user creation | ❌ Next `app/api/admin/users` (uses service-role) |
| One-off SQL / data fix | ❌ A migration |

If you can do it as RLS + direct PostgREST from the frontend, that's also fine — Edge Functions are for things that need server-only secrets (Drive tokens) or complex logic.

## Inputs you need before starting

- The endpoint name in kebab-case (e.g. `folder-rename`, `files-restore`).
- Request shape (JSON keys).
- Response shape (JSON keys — see DTO conventions in `IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md` §7).
- The required permission capability (`canView`, `canDownload`, `canUpload`, `canRename`, `canMove`, `canDelete`, `canCreateSubfolder`, `canManageAccess`).
- Whether it touches Drive (most do — affects whether you need `getAccessToken()` + `assertWithinRoot`).

## Steps

### 1. Read these first

- [`../../rules/api.md`](../../rules/api.md) — for the auth/permission patterns (same applies on the Edge Function side).
- [`../../rules/permissions.md`](../../rules/permissions.md) — for capability flag meanings.
- An existing similar function in `../../../supabase/functions/` — e.g. `folder-create` for a Drive-touching write, `connection-status` for a simple read.

### 2. Create the file

`supabase/functions/<name>/index.ts` with this skeleton (adapt to your needs):

```ts
// <name> — short one-line description.
// Required capability: <canX>.
// Flow: auth -> requirePermission -> assertWithinRoot -> drive call -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { requirePermission } from "../_shared/permissions.ts";
import { assertWithinRoot } from "../_shared/root.ts";
import { getAccessToken /* , relevantDriveHelper */ } from "../_shared/google.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));

    // 1. Validate input — narrow types BEFORE using anything.
    const { folderId, /* ...other fields */ } = body;
    if (!folderId) return errorResponse("folderId is required", 400);

    // 2. Permission check (uses get_effective_level via RPC).
    await requirePermission(user.id, folderId, /* "canX" */);

    // 3. Look up the target row(s) you need (service-role here is OK — you've already
    //    authorized via requirePermission).
    const svc = serviceClient();
    const { data: folder } = await svc
      .from("folders")
      .select("id, drive_file_id, deleted_at")
      .eq("id", folderId)
      .maybeSingle();
    if (!folder || folder.deleted_at) return errorResponse("Folder not found", 404);

    // 4. (Drive-touching only) Confine to the company root.
    const token = await getAccessToken();
    await assertWithinRoot(folder.drive_file_id, token);

    // 5. Perform the action (Drive call, DB write, etc.).
    // ...

    // 6. Audit the action AFTER it succeeded.
    await writeAudit({
      actorId: user.id,
      action: "<resource>.<verb>",
      resourceType: "<folder|file|grant|...>",
      resourceId: folder.drive_file_id, // or local id
      details: { /* what changed */ },
      ipAddress: clientIp(req),
    });

    return jsonResponse({ /* response shape */ });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("<name> error:", e);
    return errorResponse("Internal error", 500);
  }
});
```

### 3. Register the function in `supabase/config.toml`

Add a `[functions.<name>]` block with `verify_jwt = true` (or `false` if it's invoked by the cron via `CRON_SECRET`).

### 4. Add the contract to the frontend Backend interface

Match the DTO conventions from `IMPLEMENTATION_INSTRUCTIONS/00_FOUNDATION_AND_ARCHITECTURE.md` §7.

- Add a method to `lib/backend/contract.ts`.
- Implement it in `lib/backend/mockBackend.ts` (so the demo keeps working).
- Implement it in `lib/backend/supabaseBackend.ts` (fetch `POST /functions/v1/<name>`).

If the two implementations would diverge in behaviour, that's a sign the contract is wrong.

### 5. Use it from a component

Components MUST call the new operation via `getBackend().<method>(...)`, never directly via `fetch("/functions/v1/...")`.

### 6. Test

- Mock mode: exercise the UI flow that calls the new method against `MockBackend`.
- Local Supabase (`supabase start`): exercise via `curl` with a real JWT, or via the UI in supabase mode.
- Verify the audit_log row landed.

### 7. Deploy

Use the [`/deploy`](../deploy/SKILL.md) skill — it sequences backend before frontend.

## Don't do these

- ❌ Skip `assertWithinRoot` for "internal" operations. There are no internal Drive operations.
- ❌ Write to `audit_log` before the action succeeds.
- ❌ Return Drive error messages verbatim to the client (they leak internals).
- ❌ Duplicate the permission resolution algorithm in the function body. Use `requirePermission`.
- ❌ Use `verify_jwt = false` unless the function is a redirect target (OAuth callback) or invoked by the cron with `CRON_SECRET`. Re-authorize in code in those cases.

## Output

When done, report:
- Function path created.
- `config.toml` block added.
- Contract method + mock + supabase implementations.
- Component(s) updated to use it.
- Verified in mock mode (yes/no), in supabase mode (yes/no).
