// Server-only helper to extract the client IP address from a request.
//
// Header precedence (matches what Vercel, Cloudflare, most reverse proxies emit):
//   1. x-forwarded-for: "client, proxy1, proxy2"  → take the FIRST value
//   2. x-real-ip: "client"                          → take as-is
//   3. cf-connecting-ip                             → Cloudflare-specific fallback
//
// Returns null on local dev (no proxy headers present). audit_log.ip_address
// is nullable, so null is a valid value — it just means "we couldn't determine
// the source", which is the honest answer in those cases.
//
// Don't import this from a "use client" file — it's intentionally server-only
// so we never accidentally leak headers logic into the browser bundle.

export function getClientIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip");
  if (real) {
    const trimmed = real.trim();
    if (trimmed) return trimmed;
  }
  const cf = headers.get("cf-connecting-ip");
  if (cf) {
    const trimmed = cf.trim();
    if (trimmed) return trimmed;
  }
  return null;
}
