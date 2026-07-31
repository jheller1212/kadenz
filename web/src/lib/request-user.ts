// Who is making this request.
//
// lib/session.ts owns the two credential formats (the browser's session cookie
// and the native shell's bearer token). This module is the single place that
// decides which of them a given request presented, so a route never has to
// know. Every per-user read and write resolves its owner through here, which
// is what makes the shell inherit tenancy from the cookie path instead of
// having a second, parallel notion of identity that could drift from it.
//
// A route asking "whose data is this" and a route asking "may this caller in
// at all" get the same answer from the same function. proxy.ts already rejects
// unauthenticated requests, so a null here on a gated route means either the
// gate changed or the route is public; either way the route must not guess.

import { getSessionUserId, getShellTokenUserId } from "@/lib/session";
import type { UserId } from "@/lib/user-id";

/**
 * The authenticated user id for a request, or null if it carries no valid
 * credential.
 *
 * The cookie is checked first because it is the common case; a request that
 * somehow carries both is treated as the browser session it came from, which
 * is the more restrictive of the two (the cookie cannot be replayed
 * cross-site, the token can).
 */
export async function resolveRequestUserId(
  request: Request
): Promise<UserId | null> {
  const fromCookie = await getSessionUserId(request.headers.get("cookie"));
  if (fromCookie) return fromCookie;
  return getShellTokenUserId(request.headers.get("authorization"));
}

/** 401 body shared by every route that needs an identity and has none. */
export function unauthorized(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Resolves the caller, or returns the 401 to send back.
 *
 * Written as a discriminated result rather than by throwing, so that a route
 * that forgets to handle the failure case fails to compile instead of writing
 * against `undefined`. That is the whole point: a request whose owner could not
 * be established must never reach a query.
 */
export async function requireRequestUser(
  request: Request
): Promise<{ userId: UserId; response?: never } | { userId?: never; response: Response }> {
  const userId = await resolveRequestUserId(request);
  if (!userId) return { response: unauthorized() };
  return { userId };
}
