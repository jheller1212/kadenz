import type { NextRequest } from "next/server";
import { eq, and } from "drizzle-orm";
import { db, profiles } from "@/db";
import { currentUserId } from "@/db/with-user";

// ── Household profile selection ───────────────────────────────────────────────
// The active profile is a plain (non-httpOnly) cookie set client-side from
// Settings. No value / invalid value = the owner, whose scoped rows carry a
// NULL profile_id. This is a single-household trust model, not auth.

export const PROFILE_COOKIE = "kadenz_profile";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Active profile id from the request cookie, unverified; null = owner.
 *
 * The cookie is set client-side and readable/writable by anything running in
 * the browser, so this is only ever "which household member is this tab
 * showing", never proof of ownership. Now that `profiles` carries a user_id
 * (see schema.ts), any caller can put a stranger's profile id in this cookie.
 * Do not use this value to filter a query - use getVerifiedProfileId, which
 * checks the id is actually one of the caller's own profiles first.
 */
export function getActiveProfileId(request: NextRequest): string | null {
  const v = request.cookies.get(PROFILE_COOKIE)?.value;
  return v && UUID_RE.test(v) ? v : null;
}

/**
 * Active profile id from the cookie, verified against the caller's own
 * profiles; null = owner, or a cookie value that is not (or no longer) one of
 * this caller's profiles.
 *
 * Before profiles were tenanted, trusting the cookie outright was harmless -
 * every profile row belonged to the one household regardless of whose id was
 * in it. Now it is attacker-controlled input: without this check, a caller
 * could set the cookie to another athlete's profile id and have every route
 * that scopes by "the active profile" read or export that athlete's
 * check-ins, strength sessions, and history instead of their own. This is the
 * one place that check happens, so every route that cares which household
 * member is asking calls this instead of getActiveProfileId directly.
 *
 * Requires a request context (db/with-user.ts) - call it from inside a
 * withSession-wrapped handler.
 */
export async function getVerifiedProfileId(request: NextRequest): Promise<string | null> {
  const raw = getActiveProfileId(request);
  if (!raw) return null;
  const [owned] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, raw), eq(profiles.userId, currentUserId())))
    .limit(1);
  return owned ? owned.id : null;
}
