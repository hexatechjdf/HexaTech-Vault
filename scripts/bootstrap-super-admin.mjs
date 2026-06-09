#!/usr/bin/env node
/**
 * Bootstrap the first Super Admin for a fresh Supabase project.
 *
 * What it does:
 *   1. Reads next-app/.env.local for NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   2. Verifies the schema is applied (app_users + departments tables exist).
 *   3. Ensures the chosen department exists (creates it if missing).
 *   4. Creates the Auth user (skips if email already exists).
 *   5. Upserts the matching app_users row with role='super_admin', status='active'.
 *      If an old placeholder row exists for the same email (e.g. from seed.sql with a
 *      different UUID), it is removed first so the real Auth UUID wins.
 *
 * Usage (from inside next-app/):
 *   npm run bootstrap:super-admin -- --email=<EMAIL> --password=<PWD> [--name="Full Name"] \
 *     [--department=Executive] [--avatar=ZA]
 *
 * Idempotent: safe to re-run; existing rows are reconciled, not duplicated.
 *
 * Security note: the password appears in your shell history. Rotate it after first login,
 * or use a throwaway and reset via Supabase Studio.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// ---- env loading (no dotenv dependency) ---------------------------------------------------
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = {
  ...loadEnvFile(resolve(PROJECT_ROOT, ".env")),
  ...loadEnvFile(resolve(PROJECT_ROOT, ".env.local")),
};
const env = { ...fileEnv, ...process.env };

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("❌ Missing env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in next-app/.env.local.");
  process.exit(1);
}

// ---- CLI args -----------------------------------------------------------------------------
let parsed;
try {
  parsed = parseArgs({
    options: {
      email:      { type: "string" },
      password:   { type: "string" },
      name:       { type: "string" },
      department: { type: "string" },
      avatar:     { type: "string" },
      help:       { type: "boolean", short: "h" },
    },
  });
} catch (e) {
  console.error("❌", e.message);
  printUsage();
  process.exit(1);
}
const args = parsed.values;

if (args.help || !args.email || !args.password) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

function printUsage() {
  console.log(`
Bootstrap the first Super Admin.

  npm run bootstrap:super-admin -- \\
    --email=admin@yourco.com \\
    --password=YourStrongPassword123 \\
    [--name="Full Name"] \\
    [--department=Executive] \\
    [--avatar=ZA]

Required env (in next-app/.env.local):
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
`);
}

const email      = args.email.trim().toLowerCase();
const password   = args.password;
const name       = (args.name ?? "Super Admin").trim();
const department = (args.department ?? "Executive").trim();
const initials   = name.split(/\s+/).map((p) => p[0]).filter(Boolean).join("").toUpperCase().slice(0, 2) || "SA";
const avatar     = args.avatar ?? initials;

if (!email.includes("@")) {
  console.error("❌ --email must be a valid email address.");
  process.exit(1);
}
if (password.length < 8) {
  console.error("❌ --password must be at least 8 characters.");
  process.exit(1);
}

// ---- Run ----------------------------------------------------------------------------------
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function fail(prefix, error) {
  console.error(`❌ ${prefix}`, error?.message ?? error ?? "(no message)");
  process.exit(1);
}

async function main() {
  console.log(`→ Bootstrapping Super Admin`);
  console.log(`    name:       ${name}`);
  console.log(`    email:      ${email}`);
  console.log(`    department: ${department}`);
  console.log(`    avatar:     ${avatar}`);
  console.log(``);

  // 1) Schema check.
  const probe = await sb.from("app_users").select("id").limit(1);
  if (probe.error && probe.error.code === "42P01") {
    console.error("❌ Table 'app_users' not found. Apply your migrations first:");
    console.error("    supabase link --project-ref <YOUR-REF>");
    console.error("    supabase db push");
    console.error("  (or paste supabase/migrations/*.sql into the Supabase SQL Editor)");
    process.exit(1);
  }
  if (probe.error) fail("Schema probe failed:", probe.error);

  // 2) Department: find or create.
  let dept;
  {
    const { data, error } = await sb.from("departments").select("id, name").eq("name", department).maybeSingle();
    if (error) fail("Lookup department failed:", error);
    if (data) {
      dept = data;
      console.log(`✓ Department exists: ${dept.name} (${dept.id})`);
    } else {
      const ins = await sb.from("departments").insert({ name: department }).select("id, name").single();
      if (ins.error) fail("Create department failed:", ins.error);
      dept = ins.data;
      console.log(`✓ Department created: ${dept.name} (${dept.id})`);
    }
  }

  // 3) Auth user: find by email or create.
  let authUserId;
  {
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (list.error) fail("List auth users failed:", list.error);
    const existing = list.data.users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (existing) {
      authUserId = existing.id;
      console.log(`✓ Auth user already exists: ${authUserId}`);
    } else {
      const create = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (create.error) fail("Create auth user failed:", create.error);
      authUserId = create.data.user.id;
      console.log(`✓ Auth user created: ${authUserId}`);
    }
  }

  // 4) Clean up any stale app_users row for this email (e.g. from seed.sql placeholder UUIDs).
  {
    const stale = await sb.from("app_users").select("id").eq("email", email).neq("id", authUserId);
    if (!stale.error && stale.data?.length) {
      const ids = stale.data.map((r) => r.id);
      const del = await sb.from("app_users").delete().in("id", ids);
      if (del.error) fail("Remove stale app_users row failed:", del.error);
      console.log(`✓ Removed ${ids.length} stale app_users row(s) with the same email`);
    }
  }

  // 5) Upsert app_users keyed by the real Auth UUID.
  {
    const up = await sb.from("app_users").upsert(
      {
        id: authUserId,
        name,
        email,
        role: "super_admin",
        department_id: dept.id,
        avatar,
        status: "active",
      },
      { onConflict: "id" },
    );
    if (up.error) fail("Upsert app_users failed:", up.error);
    console.log(`✓ app_users profile written (role=super_admin, status=active)`);
  }

  console.log(``);
  console.log(`🎉 Done. Sign in at /login:`);
  console.log(`     email:    ${email}`);
  console.log(`     password: ${"•".repeat(Math.max(8, password.length))}`);
  console.log(``);
  console.log(`Tip: rotate this password after first login (Studio → Auth → Users → ⋯ → Reset password).`);
}

main().catch((e) => fail("Unexpected error:", e));
