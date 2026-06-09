// requireUser(req): verifies the caller's Supabase JWT and returns the matching
// app_users row. Throws an HttpError(401) if the JWT is missing/invalid or the
// authenticated auth.users id has no app_users profile.

import { serviceClient, userScopedClient } from "./supabase.ts";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: string; // user_role enum value
  department_id: string | null;
  avatar: string | null;
  status: string;
}

/** Carries an HTTP status so callers can map errors to responses. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Verifies the Authorization: Bearer <jwt> header and resolves the app_user.
 * Uses a JWT-scoped client only to validate the token / read the auth user,
 * then loads the profile with the service-role client.
 */
export async function requireUser(req: Request): Promise<AppUser> {
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header");
  }

  const scoped = userScopedClient(authHeader);
  const { data: userData, error } = await scoped.auth.getUser();
  if (error || !userData?.user) {
    throw new HttpError(401, "Invalid or expired token");
  }

  const authId = userData.user.id;
  const svc = serviceClient();
  const { data: profile, error: pErr } = await svc
    .from("app_users")
    .select("id, name, email, role, department_id, avatar, status")
    .eq("id", authId)
    .maybeSingle();

  if (pErr) throw new HttpError(500, "Failed to load user profile");
  if (!profile) throw new HttpError(401, "No app_user profile for this account");
  if (profile.status !== "active") {
    throw new HttpError(403, "User account is inactive");
  }

  return profile as AppUser;
}

/** Throws 403 unless the user is a super_admin. */
export function requireSuperAdmin(user: AppUser): void {
  if (user.role !== "super_admin") {
    throw new HttpError(403, "Super admin only");
  }
}
