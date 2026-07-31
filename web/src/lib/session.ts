// Uses Web Crypto API — compatible with both Edge Runtime (proxy) and Node.js runtime (API routes).

import { asUserId, isUserId, type UserId } from "./user-id";

const COOKIE_NAME = "session";

// A session naturally expires after this long, so a captured cookie (shared
// device, synced browser) doesn't stay valid forever just because logout
// only clears the browser's copy. Matches the cookie's own Max-Age, which
// was already 30 days.
const MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;

// Small tolerance for clock drift between the server that minted the cookie
// and the one validating it, so a legitimate fresh cookie is never rejected
// for looking "issued in the future" by a few seconds.
const CLOCK_SKEW_TOLERANCE_MS = 1000 * 60 * 5;

// The signed value is "<userId>:<issuedAtMs>".
//
// It used to be the literal string "authenticated" plus a timestamp, which
// proved a browser held a signed value but never said whose browser it was.
// Carrying the user id is what lets a request know which athlete is asking.
// The id is the subject of the session, so it is inside the HMAC-signed
// payload and cannot be swapped for someone else's without the secret.
//
// Cookies in the old format fail parseUserId below and are rejected outright
// rather than being read as the owner. Treating them as user 1 would mean any
// still-valid old cookie silently became a full owner session in a world where
// other users can exist, which is exactly the hole this change closes.
function buildSignedPayload(userId: string, issuedAtMs: number): string {
  return `${userId}:${issuedAtMs}`;
}

// Session subjects are database uuids. Anything else in that position (most
// notably the old literal "authenticated") is not a user and is rejected. The
// shape check lives in lib/user-id.ts so there is one definition of what a user
// id looks like rather than one per file that needed to know.

/** Returns the user id carried by a signed payload, or null if it carries none. */
export function parseUserId(value: string): UserId | null {
  const sepIndex = value.lastIndexOf(":");
  if (sepIndex === -1) return null;
  const raw = value.slice(0, sepIndex);
  return isUserId(raw) ? asUserId(raw) : null;
}

// Returns the embedded issued-at timestamp, or null if `value` is a legacy
// pre-expiry cookie (no timestamp) or otherwise malformed.
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

/** Mints a session for `userId`. There is no such thing as an anonymous session. */
export async function makeSessionCookie(userId: UserId): Promise<string> {
  if (!isUserId(userId)) {
    // Unreachable through the type, and kept as a runtime guard because this
    // mints the credential the whole app trusts: a caller that reached here with
    // a bad value through a cast must not get a working session out of it.
    throw new Error("makeSessionCookie requires a user id");
  }
  const secret = getSecret();
  const payload = buildSignedPayload(userId.toLowerCase(), Date.now());
  const sig = await hmacSign(payload, secret);
  const signed = `${payload}.${sig}`;
  // HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30 days
  return `${COOKIE_NAME}=${signed}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${MAX_AGE_MS / 1000}`;
}

/** Expired cookie header that clears the session (logout). */
export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * Returns the id of the user this cookie belongs to, or null if the cookie is
 * absent, unsigned, tampered with, expired, or in the pre-identity format.
 *
 * This is the one place a request's identity comes from. Phase 3 of the
 * multi-user plan feeds its return value into the per-request database
 * context; nothing else should try to work out who is calling.
 */
export async function getSessionUserId(
  cookieHeader: string | null
): Promise<UserId | null> {
  if (!cookieHeader) return null;
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), v.join("=").trim()];
    })
  );
  const signed = cookies[COOKIE_NAME];
  if (!signed) return null;

  const dotIndex = signed.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const value = signed.slice(0, dotIndex);
  const signature = signed.slice(dotIndex + 1);

  try {
    const secret = getSecret();
    if (!(await hmacVerify(value, signature, secret))) return null;
  } catch {
    return null;
  }

  // Enforce expiry. A cookie minted before the expiry change shipped has no
  // embedded timestamp (parseIssuedAtMs returns null) and is treated as
  // expired, rather than being trusted forever the way it once was.
  const issuedAtMs = parseIssuedAtMs(value);
  if (issuedAtMs === null) return null;
  if (!isSessionFresh(issuedAtMs, Date.now())) return null;

  // Correctly signed and still fresh, but carrying "authenticated" instead of
  // a user id: a cookie from before identity existed. Rejected, not assumed to
  // be the owner. This is the one-off re-login the change notes call out.
  return parseUserId(value);
}

/** True if the cookie carries a valid session. Prefer getSessionUserId. */
export async function validateSessionCookie(
  cookieHeader: string | null
): Promise<boolean> {
  return (await getSessionUserId(cookieHeader)) !== null;
}

// ── Bearer tokens for the native shell ───────────────────────────────────────
//
// The Capacitor shell runs on a capacitor:// (or http://localhost) origin and
// calls the API cross-site. The session cookie is SameSite=Lax and is
// therefore not sent on those requests, so every call came back 401.
//
// Relaxing the cookie to SameSite=None would fix the shell and weaken CSRF
// posture for every browser session at the same time, which is a bad trade for
// one client. A bearer token the shell sends explicitly is opt-in per request
// and carries no ambient authority.
//
// The token is minted from an already-authenticated session (see
// /api/auth/shell/token) and resolves to a user id through the same signature
// scheme and the same identity accessor shape as the cookie, so anything built
// on lib/request-user.ts inherits tenancy without knowing which credential the
// caller used.

// Short by design: a copy that leaks off the device stops working within a
// day. The shell refreshes on launch by presenting its still-valid token
// (rotation), so a running install never asks the athlete to log in again;
// one that has been closed for longer falls back to the web login it used to
// get its first token.
const SHELL_TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 24;

// Domain separation between the two credential formats, and it is doing real
// work in both directions. A cookie payload is "<uuid>:<ms>", so a shell token
// presented as a cookie fails parseUserId (its subject reads as
// "shell:<uuid>", not a uuid) and a cookie value presented as a bearer fails
// the prefix check below. One signing secret, two credentials that cannot be
// swapped for each other.
const SHELL_PREFIX = "shell:";

function buildShellPayload(userId: UserId, issuedAtMs: number): string {
  return `${SHELL_PREFIX}${userId}:${issuedAtMs}`;
}

/** Mints a shell bearer token for `userId`. */
export async function makeShellToken(userId: UserId): Promise<string> {
  if (!isUserId(userId)) {
    // Unreachable through the type, kept as a runtime guard for the same
    // reason as makeSessionCookie: this mints a credential the app trusts.
    throw new Error("makeShellToken requires a user id");
  }
  const secret = getSecret();
  const payload = buildShellPayload(asUserId(userId), Date.now());
  const sig = await hmacSign(payload, secret);
  return `${payload}.${sig}`;
}

/** How long a freshly minted shell token stays valid, in seconds. */
export const SHELL_TOKEN_MAX_AGE_SECONDS = SHELL_TOKEN_MAX_AGE_MS / 1000;

/**
 * Returns the id of the user a shell bearer token belongs to, or null if the
 * header is absent, malformed, not a shell token, tampered with, or expired.
 *
 * Takes the raw Authorization header so the caller cannot accidentally pass a
 * token from somewhere other than the request.
 */
export async function getShellTokenUserId(
  authorizationHeader: string | null
): Promise<UserId | null> {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();

  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;
  const value = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  if (!value.startsWith(SHELL_PREFIX)) return null;

  try {
    const secret = getSecret();
    if (!(await hmacVerify(value, signature, secret))) return null;
  } catch {
    return null;
  }

  const issuedAtMs = parseIssuedAtMs(value);
  if (issuedAtMs === null) return null;
  if (!isSessionFresh(issuedAtMs, Date.now(), SHELL_TOKEN_MAX_AGE_MS)) {
    return null;
  }

  // Strip the prefix before reading the subject, so the uuid check runs
  // against the id itself and a token whose subject is not a uuid is rejected
  // rather than half-parsed.
  return parseUserId(value.slice(SHELL_PREFIX.length));
}
