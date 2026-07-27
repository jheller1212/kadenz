// Uses Web Crypto API — compatible with both Edge Runtime (proxy) and Node.js runtime (API routes).

const COOKIE_NAME = "session";
const SESSION_VALUE = "authenticated";

// A session naturally expires after this long, so a captured cookie (shared
// device, synced browser) doesn't stay valid forever just because logout
// only clears the browser's copy. Matches the cookie's own Max-Age, which
// was already 30 days.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

// Small tolerance for clock drift between the server that minted the cookie
// and the one validating it, so a legitimate fresh cookie is never rejected
// for looking "issued in the future" by a few seconds.
const CLOCK_SKEW_TOLERANCE_MS = 1000 * 60 * 5;

// The signed value is "authenticated:<issuedAtMs>". A pre-expiry cookie
// (minted before this change shipped) is just "authenticated" with no ":" —
// see parseIssuedAtMs below for how that's handled.
function buildSignedPayload(issuedAtMs: number): string {
  return `${SESSION_VALUE}:${issuedAtMs}`;
}

// Returns the embedded issued-at timestamp, or null if `value` is a legacy
// pre-expiry cookie (no timestamp) or malformed.
export function parseIssuedAtMs(value: string): number | null {
  const sepIndex = value.lastIndexOf(":");
  if (sepIndex === -1) return null;
  const raw = value.slice(sepIndex + 1);
  const ms = Number(raw);
  return Number.isFinite(ms) ? ms : null;
}

// Whether a session issued at `issuedAtMs` is still within its max age as of
// `nowMs`. Exported as a pure function so the expiry math is unit-testable
// without touching cookies or crypto.
export function isSessionFresh(
  issuedAtMs: number,
  nowMs: number,
  maxAgeMs: number = MAX_AGE_MS
): boolean {
  const age = nowMs - issuedAtMs;
  return age >= -CLOCK_SKEW_TOLERANCE_MS && age <= maxAgeMs;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET env var is not set");
  return secret;
}

async function hmacSign(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function hmacVerify(value: string, signature: string, secret: string): Promise<boolean> {
  const expected = await hmacSign(value, secret);
  if (expected.length !== signature.length) return false;
  // Constant-time compare via XOR
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function makeSessionCookie(): Promise<string> {
  const secret = getSecret();
  const payload = buildSignedPayload(Date.now());
  const sig = await hmacSign(payload, secret);
  const signed = `${payload}.${sig}`;
  // HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30 days
  return `${COOKIE_NAME}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}`;
}

/** Expired cookie header that clears the session (logout). */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function validateSessionCookie(cookieHeader: string | null): Promise<boolean> {
  if (!cookieHeader) return false;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), v.join("=").trim()];
    })
  );
  const signed = cookies[COOKIE_NAME];
  if (!signed) return false;

  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return false;
  const value = signed.slice(0, dotIndex);
  const signature = signed.slice(dotIndex + 1);

  try {
    const secret = getSecret();
    if (!(await hmacVerify(value, signature, secret))) return false;
  } catch {
    return false;
  }

  // Enforce expiry. A cookie minted before this change shipped has no
  // embedded timestamp (parseIssuedAtMs returns null) and is treated as
  // expired: Jonas needs one clean re-login after this deploys, rather than
  // that cookie being trusted forever the way it was before.
  const issuedAtMs = parseIssuedAtMs(value);
  if (issuedAtMs === null) return false;
  return isSessionFresh(issuedAtMs, Date.now());
}
