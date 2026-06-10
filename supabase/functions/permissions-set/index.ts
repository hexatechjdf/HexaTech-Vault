// permissions-set ({folderId, principalType, principalId, level, expiresAt?})
// (item 04). Upserts a per-folder grant. Caller must be super_admin OR have
// full_control (manage access) on the folder.
//
// Model B (Drive-native): for USER principals we also call Drive's
// permissions.create with the target's email so they can open the folder in
// their own Drive. The returned Drive permission id is stored in
// permission_grants.drive_permission_id (migration 0009) so we can revoke or
// update later. Level changes revoke + recreate the Drive permission. Setting
// 'no_access' revokes the Drive share.
//
// Department / role grants stay app-side only.
//
// auth -> permission(manage_access) -> escalation guard -> Drive share
//   (user only) -> upsert grant -> audit.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  requirePermission,
  rankOf,
  PermLevel,
} from "../_shared/permissions.ts";
import { writeAudit, clientIp } from "../_shared/audit.ts";
import {
  getAccessToken,
  addDrivePermission,
  removeDrivePermission,
  permLevelToDriveRole,
} from "../_shared/google.ts";

const VALID_LEVELS: PermLevel[] = [
  "no_access",
  "view",
  "view_download",
  "view_upload",
  "contributor",
  "full_control",
];
// Department grants were removed - the permission system now supports two
// principal types only: user and role. Migration 0015 cleared existing dept
// grants; this rejection blocks new ones at the API layer.
const VALID_PRINCIPALS = ["user", "role"];

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    const user = await requireUser(req);
    const body = await req.json().catch(() => ({}));
    const { folderId, principalType, principalId, level, expiresAt } = body;
    // Optional department scope for role grants. Null/undefined means
    // "all departments" (matches the pre-0021 behaviour). A real uuid
    // narrows the grant to users with this role AND that department.
    const principalDeptId: string | null = body.principalDeptId ?? null;

    if (!folderId || !principalType || !principalId || !level) {
      return errorResponse("folderId, principalType, principalId and level are required", 400);
    }
    if (!VALID_PRINCIPALS.includes(principalType)) {
      return errorResponse("Invalid principalType", 400);
    }
    if (!VALID_LEVELS.includes(level)) {
      return errorResponse("Invalid level", 400);
    }

    // Department scope only makes sense for role grants.
    if (principalType === "user" && principalDeptId) {
      return errorResponse("principalDeptId may only be set when principalType='role'", 400);
    }
    // If a dept id was sent for a role grant, confirm it points at a real dept.
    if (principalType === "role" && principalDeptId) {
      const { data: dept } = await serviceClient()
        .from("departments")
        .select("id")
        .eq("id", principalDeptId)
        .maybeSingle();
      if (!dept) return errorResponse("principalDeptId does not match a real department", 422);
    }

    // Super Admin is not a grantable target. They own the company Drive and
    // have full_control everywhere by definition - granting them anything
    // would be a no-op at best and confusing at worst.
    if (principalType === "role" && principalId === "super_admin") {
      return errorResponse("Cannot grant to the super_admin role", 422);
    }
    if (principalType === "user") {
      const { data: target } = await serviceClient()
        .from("app_users")
        .select("role")
        .eq("id", principalId)
        .maybeSingle();
      if (target?.role === "super_admin") {
        return errorResponse("Cannot grant to a super admin user", 422);
      }
    }

    // Manage-access gate.
    const callerLevel = await requirePermission(user.id, folderId, "manage_access");

    // Escalation guard: a non-super_admin manager cannot grant above their own
    // effective level on this folder.
    if (user.role !== "super_admin" && rankOf(level as PermLevel) > rankOf(callerLevel)) {
      return errorResponse(
        `Cannot grant '${level}' - exceeds your own level '${callerLevel}'`,
        403,
      );
    }

    const svc = serviceClient();

    // Resolve target Drive file id.
    const { data: folder } = await svc
      .from("folders")
      .select("drive_file_id")
      .eq("id", folderId)
      .maybeSingle();
    if (!folder) return errorResponse("Folder not found", 404);

    // For user grants: look up prior grant + target email.
    let priorDriveId: string | null = null;
    let targetEmail: string | null = null;
    if (principalType === "user") {
      // User grants always have principal_dept_id = NULL, so this lookup is
      // unambiguous.
      const { data: prior } = await svc
        .from("permission_grants")
        .select("drive_permission_id")
        .eq("folder_id", folderId)
        .eq("principal_type", "user")
        .eq("principal_id", principalId)
        .is("principal_dept_id", null)
        .maybeSingle();
      priorDriveId = (prior?.drive_permission_id as string | null) ?? null;

      const { data: target } = await svc
        .from("app_users")
        .select("email, google_email, status")
        .eq("id", principalId)
        .maybeSingle();
      if (!target) return errorResponse("Target user not found", 404);
      if (target.status !== "active") {
        return errorResponse("Target user is inactive", 422);
      }
      // Drive sharing prefers google_email when the user has set it (Profile
      // page). If null we fall back to the login email - which still might
      // not be a Google account, in which case Drive will reject the share
      // and the BFF returns 502 (no app-side row written).
      targetEmail = (target.google_email as string | null) ?? target.email;
    }

    // ---- Drive side (user grants only) ----
    let newDrivePermissionId: string | null = priorDriveId;
    if (principalType === "user" && targetEmail) {
      const driveRole = permLevelToDriveRole(level);
      try {
        const token = await getAccessToken();
        // Always revoke any prior permission. Drive's permissions API has no
        // clean upsert: PATCH only edits known permissions, and creating a new
        // one without removing the old leaves duplicates on role change.
        if (priorDriveId) {
          await removeDrivePermission(token, folder.drive_file_id, priorDriveId).catch(() => {
            // Best-effort: stale ids are common; don't fail the grant for it.
          });
        }
        if (driveRole) {
          const created = await addDrivePermission(
            token,
            folder.drive_file_id,
            driveRole,
            targetEmail,
          );
          newDrivePermissionId = created.id;
        } else {
          newDrivePermissionId = null; // no_access - Drive perm fully revoked above
        }
      } catch (driveErr) {
        const raw = (driveErr as Error).message ?? "";
        // Always log the raw Drive error for ops/debugging - the user never
        // sees this. The friendly message returned to the client never leaks
        // the raw JSON, status code, or stack trace.
        console.error("permissions-set Drive error:", raw);
        const { message, status } = translateDriveError(raw, targetEmail);
        // Fail the whole call so app and Drive state can't diverge.
        return errorResponse(message, status);
      }
    }

    // ---- App side ----
    //
    // Role grants with level=no_access are treated as "clear the slot" instead
    // of "explicit revocation". Picking "No Access" in the FAC dropdown is the
    // default state for any role/dept combination that has no grant, so storing
    // an actual row for it produced a hidden blocker: the user-wins engine sees
    // the row at the nearest ancestor and stops walking, returning no_access
    // even when an ancestor folder had a positive role grant. Deleting the row
    // makes "No Access" mean "no grant exists", which matches the dropdown's
    // visual semantics.
    //
    // User grants are NOT affected — explicit no_access for a specific user
    // is a documented revocation feature (see .claude/rules/permissions.md).
    if (principalType === "role" && level === "no_access") {
      const delQuery = svc
        .from("permission_grants")
        .delete()
        .eq("folder_id", folderId)
        .eq("principal_type", "role")
        .eq("principal_id", principalId);
      if (principalDeptId === null) {
        delQuery.is("principal_dept_id", null);
      } else {
        delQuery.eq("principal_dept_id", principalDeptId);
      }
      const { error: delErr } = await delQuery;
      if (delErr) throw new HttpError(500, "Failed to clear grant");

      await writeAudit({
        actorId: user.id,
        action: "perm.revoke",
        resourceType: "permission",
        resourceId: folderId,
        details: { folderId, principalType, principalId, principalDeptId, level: "no_access" },
        ipAddress: clientIp(req),
      });

      return jsonResponse({ ok: true, cleared: true });
    }

    //
    // The composite uniqueness lives in the partial unique index
    // `permission_grants_unique_principal` (migration 0021) on
    // (folder_id, principal_type, principal_id, COALESCE(principal_dept_id, sentinel)).
    // PostgREST's `onConflict` only supports column names, not expressions, so
    // we do a manual "find existing row → update or insert" rather than the
    // upsert convenience. This is the only conflict-safe path that respects
    // role+dept as part of the key.
    const existingQuery = svc
      .from("permission_grants")
      .select("id")
      .eq("folder_id", folderId)
      .eq("principal_type", principalType)
      .eq("principal_id", principalId);
    if (principalDeptId === null) {
      existingQuery.is("principal_dept_id", null);
    } else {
      existingQuery.eq("principal_dept_id", principalDeptId);
    }
    const { data: existing } = await existingQuery.maybeSingle();

    let upserted: { id: string } | null;
    let error: { message: string } | null = null;
    if (existing) {
      const r = await svc
        .from("permission_grants")
        .update({
          level,
          granted_by: user.id,
          expires_at: expiresAt ?? null,
          drive_permission_id: newDrivePermissionId,
        })
        .eq("id", existing.id)
        .select("id")
        .single();
      upserted = r.data as { id: string } | null;
      error = r.error;
    } else {
      const r = await svc
        .from("permission_grants")
        .insert({
          folder_id: folderId,
          principal_type: principalType,
          principal_id: principalId,
          principal_dept_id: principalDeptId,
          level,
          granted_by: user.id,
          expires_at: expiresAt ?? null,
          drive_permission_id: newDrivePermissionId,
        })
        .select("id")
        .single();
      upserted = r.data as { id: string } | null;
      error = r.error;
    }

    if (error) throw new HttpError(500, "Failed to save grant");

    await writeAudit({
      actorId: user.id,
      action: "perm.grant",
      resourceType: "permission",
      resourceId: folderId,
      details: {
        folderId,
        principalType,
        principalId,
        principalDeptId,
        level,
        expiresAt: expiresAt ?? null,
        drivePermissionId: newDrivePermissionId,
      },
      ipAddress: clientIp(req),
    });

    return jsonResponse({
      ok: true,
      grantId: upserted?.id,
      drivePermissionId: newDrivePermissionId,
    });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("permissions-set error:", e);
    return errorResponse("Internal error", 500);
  }
});

// ─── Drive error translation ────────────────────────────────────────────────
//
// Raw Drive errors look like:
//   'Drive API 403: { "error": { "code": 403, "message":
//     "Forbidden. User message: \\"Sorry, you cannot share with x@y.com
//      because they do not have a Google Account.\\"", ... }'
//
// The user-facing toast should NEVER show that. translateDriveError turns
// the raw message into a plain-English sentence the admin can act on, plus
// an appropriate HTTP status:
//   422  client-fixable (wrong email, etc.)
//   502  Drive-side problem (auth expired, server error, rate limit)

function translateDriveError(raw: string, targetEmail: string): { message: string; status: number } {
  // Specific case the user hit: target email is not a Google account.
  if (/do not have a Google Account/i.test(raw)) {
    return {
      message:
        `Could not share with ${targetEmail}: this isn't a Google account. ` +
        `Ask them to set a Google account email in their Profile, or use a ` +
        `Gmail / Google Workspace address.`,
      status: 422,
    };
  }

  // Drive sometimes wraps its own friendly text inside the JSON. Extract and
  // use it directly if present. The pattern is: User message: \"<text>\"
  const userMsgMatch = raw.match(/User message:\s*\\?"([^"\\]+)"/i);
  if (userMsgMatch && userMsgMatch[1]) {
    return {
      message: `Google Drive rejected the share: ${userMsgMatch[1].trim()}`,
      status: 422,
    };
  }

  // Drive folder was deleted or moved out of scope.
  if (/Drive API 404/i.test(raw) || /File not found/i.test(raw)) {
    return {
      message: "The folder no longer exists in Google Drive. Click Sync and try again.",
      status: 422,
    };
  }

  // Drive auth expired or revoked.
  if (/Drive API 401/i.test(raw)) {
    return {
      message: "Google Drive authorisation expired. Ask the Super Admin to reconnect Drive in Settings.",
      status: 502,
    };
  }

  // Rate limit.
  if (/Drive API 429/i.test(raw)) {
    return {
      message: "Google Drive is rate-limiting requests. Please try again in a moment.",
      status: 502,
    };
  }

  // Drive server problem.
  if (/Drive API 5\d\d/i.test(raw)) {
    return {
      message: "Google Drive is having trouble right now. Please try again shortly.",
      status: 502,
    };
  }

  // Generic Drive 403 with no specific user message attached.
  if (/Drive API 403/i.test(raw)) {
    return {
      message:
        `Google Drive refused the share to ${targetEmail}. ` +
        `Check that the address is a valid Google account.`,
      status: 422,
    };
  }

  // Fallback - keep it neutral, never expose the raw text to the user.
  return {
    message: `Could not share the folder with ${targetEmail}. Please verify the email and try again.`,
    status: 502,
  };
}
