import { redirect } from "next/navigation";

// Server component entrypoint. For now we always send people to /login.
// Once real session-based auth is implemented, this will inspect the Supabase
// session cookie (via lib/supabase/server.ts) and redirect signed-in users to /dashboard.
// See ../GETTING_STARTED.md auth plan.
export default function HomePage() {
  redirect("/login");
}
