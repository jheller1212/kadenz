// Email magic-link tokens: mint, hash, and single-use consume.
//
// ── Lifetime and storage ──────────────────────────────────────────────────────
//
// A token is valid for 15 minutes from issue and can be consumed exactly
// once. The database never stores the raw token, only an HMAC-SHA256 of it
// (same secret and primitive as session.ts's cookie signature), so a leaked
// database row is not a working link -- forging a valid hash for a chosen
// token still requires SESSION_SECRET.
//
// ── Why this is not a plain lookup-by-hash ────────────────────────────────────
//
// Hashing the token and looking it up by exact equality (WHERE token_hash =
// $1) would work functionally -- HMAC output collides with negligible
// probability -- but it means the presented token is compared to the stored
// value one way: whatever Postgres's index equality does internally. The
// consume route instead narrows to the small set of that address's still-live
// tokens (bounded by the rate limit, normally 0 or 1) and constant-time
// compares the presented token against each one with hmacVerify, the same
// function session.ts already uses to check a cookie's signature. One way to
// compare a secret-derived value against user input, used everywhere it
// happens.

import { randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, emailLoginTokens } from "@/db";
import { getSecret, hmacSign, hmacVerify } from "@/lib/session";

export const EMAIL_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Lower-cased, trimmed. The one normalization every reader and writer uses. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function randomToken(): string {
  // 256 bits, matching the unguessability the session cookie's own HMAC key
  // provides -- this is the thing an attacker gets to guess, not the hash.
  return randomBytes(32).toString("base64url");
}

/**
 * Mints a token for `email`, stores its hash, and returns the raw token to
 * put in the emailed link. The caller (the request route) is responsible for
 * rate limiting before calling this -- this function itself has no opinion on
 * how many tokens an address may hold.
 */
export async function createEmailLoginToken(
  email: string,
  requestedIp: string | null
): Promise<string> {
  const secret = getSecret();
  const token = randomToken();
  const tokenHash = await hmacSign(token, secret);
  const now = Date.now();

  await db.insert(emailLoginTokens).values({
    email: normalizeEmail(email),
    tokenHash,
    requestedIp,
    expiresAt: new Date(now + EMAIL_TOKEN_TTL_MS),
  });

  return token;
}

export type ConsumeResult =
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "expired" | "already_used" };

/**
 * Verifies `token` against `email`'s still-unconsumed, unexpired tokens and,
 * on a match, marks that row consumed in the same statement that finds it --
 * an UPDATE with `consumed_at IS NULL` in its WHERE clause, so two requests
 * racing the same token can only ever have one winner. Single use is a
 * database property here, not a check-then-act the caller could get wrong.
 */
export async function consumeEmailLoginToken(
  email: string,
  token: string
): Promise<ConsumeResult> {
  const secret = getSecret();
  const normalized = normalizeEmail(email);
  const now = new Date();

  // Bounded by the rate limit (normally 0-1 live rows), never the whole
  // table -- this is a candidate set to compare against, not a lookup.
  const candidates = await db
    .select({
      id: emailLoginTokens.id,
      tokenHash: emailLoginTokens.tokenHash,
      expiresAt: emailLoginTokens.expiresAt,
    })
    .from(emailLoginTokens)
    .where(
      and(
        eq(emailLoginTokens.email, normalized),
        isNull(emailLoginTokens.consumedAt)
      )
    );

  if (candidates.length === 0) {
    return { ok: false, reason: "not_found" };
  }

  for (const candidate of candidates) {
    // hmacVerify is constant-time in the comparison itself; which candidate
    // it is compared against still varies with how many live tokens the
    // address has, which is small and rate-limited, not secret-dependent.
    const matches = await hmacVerify(token, candidate.tokenHash, secret);
    if (!matches) continue;

    if (candidate.expiresAt.getTime() < now.getTime()) {
      return { ok: false, reason: "expired" };
    }

    const [claimed] = await db
      .update(emailLoginTokens)
      .set({ consumedAt: now })
      .where(
        and(
          eq(emailLoginTokens.id, candidate.id),
          isNull(emailLoginTokens.consumedAt),
          gt(emailLoginTokens.expiresAt, now)
        )
      )
      .returning({ id: emailLoginTokens.id });

    if (!claimed) {
      // Lost the race (another request consumed it between the select above
      // and this update), or it expired in that same window.
      return { ok: false, reason: "already_used" };
    }

    return { ok: true, email: normalized };
  }

  // A token was presented that doesn't match any live row for this address --
  // tampered, or already consumed and no longer "live" (consumed_at set).
  return { ok: false, reason: "not_found" };
}
