// directory-departments — returns the department list for pickers (creation wizard,
// folder access control). Any authenticated app_user may read it.
//
// auth -> select departments.

import { handlePreflight, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { requireUser, HttpError } from "../_shared/auth.ts";
import { serviceClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;

  try {
    await requireUser(req);
    const svc = serviceClient();
    const { data, error } = await svc
      .from("departments")
      .select("id, name")
      .order("name", { ascending: true });
    if (error) return errorResponse("Failed to load departments", 500);
    return jsonResponse({ departments: data ?? [] });
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.message, e.status);
    console.error("directory-departments error:", e);
    return errorResponse("Internal error", 500);
  }
});
