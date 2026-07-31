// ── Why a user id is not a string ────────────────────────────────────────────
//
// Two live bugs of the identical shape appeared within an hour of each other,
// both from widening a function with a new user id parameter next to existing
// string parameters:
//
//   queueGarminWindowSync(planId)        // planId satisfied `userId: string`
//   queueStrengthSessionSync(id, "delete", "gcal", { gcalEventId })
//                                       // "gcal" satisfied `userId: string`,
//                                       // and the options object became target
//
// Both type-checked. Both ran without error. Both silently queried for a user
// that does not exist, matched nothing, and did nothing: no compile error, no
// runtime error, no log line. `tsc` is structurally incapable of catching either,
// because every argument involved is a string and so every argument is
// interchangeable with every other.
//
// So a user id stops being a string. `UserId` is a branded type: assignable TO
// string, so nothing that merely consumes one needs changing, but a plain string
// is NOT assignable to it. `queueGarminWindowSync(planId)` becomes a build
// failure rather than a silent no-op, and so does the next one somebody writes
// when they widen one of these without noticing the argument next door is also a
// string.
//
// The brand is producible only by the resolvers that genuinely establish
// identity (getSessionUserId, currentUserId, forEachUser, resolveUserForLogin)
// and by asUserId below, which validates. That is what keeps the guarantee real:
// if any string could be branded silently, the type would be decoration.
//
// ── Why this lives in its own module with no imports ─────────────────────────
//
// src/lib/session.ts needs it, and session.ts is imported by src/proxy.ts, which
// runs in the Edge runtime. Putting the brand in db/with-user.ts would pull the
// whole database client into the Edge bundle through that chain and break the
// proxy. This module imports nothing, so it is safe from anywhere.

export type UserId = string & { readonly __brand: "UserId" };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True if `raw` has the shape of a user id. */
export function isUserId(raw: string): boolean {
  return UUID_RE.test(raw);
}

/**
 * Asserts a raw string really is a user id, and brands it.
 *
 * For the narrow set of callers holding an id that did not come from the current
 * request: a seeded constant (OWNER_USER_ID), a `user_id` column read off a row,
 * an id resolved from `user_identities` in the Strava webhook. It validates
 * rather than merely casting, so a plan id passed here throws immediately
 * instead of becoming a query that quietly matches nothing.
 *
 * If you are reaching for this inside a request handler, use `currentUserId()`
 * instead. That it exists at all is what makes the brand adoptable; using it
 * where a resolver would do is what would make the brand meaningless.
 */
export function asUserId(raw: string): UserId {
  if (!isUserId(raw)) {
    throw new Error(
      `asUserId received something that is not a user id: ${JSON.stringify(raw)}. A user id is a uuid. This check is what catches an id of the wrong kind (a plan id, a session id, a sync target name) before it becomes a query that silently matches nothing.`
    );
  }
  return raw.toLowerCase() as UserId;
}
