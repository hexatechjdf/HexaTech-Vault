// AES-256-GCM encrypt/decrypt for the Google refresh token, using Web Crypto
// (available in the Deno Edge runtime). The 32-byte key comes from the
// TOKEN_ENCRYPTION_KEY secret.
//
// Storage format (single string, base64):
//   base64( iv[12 bytes] || ciphertext+tag )
// The 12-byte random IV is prepended to the ciphertext so decryption is
// self-describing. AES-GCM appends the 16-byte auth tag to the ciphertext.

import { requireEnv } from "./supabase.ts";

const IV_LENGTH = 12; // 96-bit nonce recommended for GCM

/**
 * Derives a 32-byte AES key from TOKEN_ENCRYPTION_KEY. Accepts either:
 *   - a base64 string decoding to exactly 32 bytes, or
 *   - a raw UTF-8 string of exactly 32 chars, or
 *   - any other string, in which case it is SHA-256'd to 32 bytes.
 */
async function getKey(): Promise<CryptoKey> {
  const raw = requireEnv("TOKEN_ENCRYPTION_KEY");
  let keyBytes: Uint8Array;

  const fromB64 = tryDecodeBase64(raw);
  if (fromB64 && fromB64.length === 32) {
    keyBytes = fromB64;
  } else if (new TextEncoder().encode(raw).length === 32) {
    keyBytes = new TextEncoder().encode(raw);
  } else {
    // Normalize any other input to 32 bytes deterministically.
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(raw),
    );
    keyBytes = new Uint8Array(digest);
  }

  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function tryDecodeBase64(s: string): Uint8Array | null {
  try {
    const bin = atob(s);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encrypts plaintext → base64(iv || ciphertext+tag). */
export async function encrypt(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return toBase64(out);
}

/** Decrypts base64(iv || ciphertext+tag) → plaintext. */
export async function decrypt(stored: string): Promise<string> {
  const key = await getKey();
  const data = fromBase64(stored);
  const iv = data.slice(0, IV_LENGTH);
  const ct = data.slice(IV_LENGTH);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
  return new TextDecoder().decode(pt);
}

// ---------------------------------------------------------------------------
// Signed single-use state nonce for the OAuth flow (drive-oauth-start/callback).
// We HMAC-sign a payload { uid, nonce, exp } so the callback can verify the
// state was issued by us and is tied to the initiating super_admin, without
// needing a server-side session store. Single-use is additionally enforced by
// the drive_connection 409 guard (a connection can only be created once).
// ---------------------------------------------------------------------------

interface StatePayload {
  uid: string;
  nonce: string;
  exp: number; // epoch ms
}

async function hmacKey(): Promise<CryptoKey> {
  const raw = requireEnv("TOKEN_ENCRYPTION_KEY");
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(raw),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function b64urlEncode(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return fromBase64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}

/** Builds a signed state string valid for `ttlMs` (default 10 min). */
export async function signState(uid: string, ttlMs = 10 * 60 * 1000): Promise<string> {
  const payload: StatePayload = {
    uid,
    nonce: crypto.randomUUID(),
    exp: Date.now() + ttlMs,
  };
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey();
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return `${body}.${b64urlEncode(sig)}`;
}

/** Verifies a signed state string; returns the uid or throws. */
export async function verifyState(state: string): Promise<string> {
  const [body, sig] = state.split(".");
  if (!body || !sig) throw new Error("Malformed state");
  const key = await hmacKey();
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(body),
  );
  if (!ok) throw new Error("Invalid state signature");
  const payload = JSON.parse(
    new TextDecoder().decode(b64urlDecode(body)),
  ) as StatePayload;
  if (Date.now() > payload.exp) throw new Error("State expired");
  return payload.uid;
}
