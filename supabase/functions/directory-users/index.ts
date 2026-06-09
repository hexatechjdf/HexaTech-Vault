// directory-users — returns the user directory for pickers (assignees, access grants,
// creation wizard). Any authenticated app_user may read it. Returns the camelCase
// AppUser shape the frontend expects (id, name, email, role, departmentId,
// departmentName, avatar, status).
//
// auth -> select app_users joined to departments.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

interface UserRow {
  id: string;
  name: string;
  email: string;
  google_email: string | null;
  role: string;
  department_id: string | null;
  avatar: string | null;
  status: string;
  departments: { name: string } | { name: string }[] | null;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    await requireUser(req);
    const svc = serviceClient();
    const { data, error } = await svc
      .from("app_users")
      .select("id, name, email, google_email, role, department_id, avatar, status, departments(name)")
      .order("name", { ascending: true });
    if (error) return errorResponse("Failed to load users", 500);

    const users = (data ?? []).map((u: UserRow) => {
      const dept = Array.isArray(u.departments) ? u.departments[0] : u.departments;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        googleEmail: u.google_email,
        role: u.role,
        departmentId: u.department_id,
        departmentName: dept?.name ?? "",
        avatar: u.avatar ?? (u.name ?? "").slice(0, 2).toUpperCase(),
        status: u.status,
      };
    });
    return jsonResponse({ users });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("directory-users error:", e);
    return errorResponse("Internal error", 500);
  }
});
