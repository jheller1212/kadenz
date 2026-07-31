// Full account erasure: both app stores require an in-app deletion path, and
// GDPR requires an actual erase, not a flag flipped somewhere. This is that
// path, and it is written to survive the schema growing without anyone
// remembering to come back here.
//
// ── Why this is discovered, not listed ────────────────────────────────────────
//
// drizzle/0064_rls_covers_every_tenanted_table.sql exists because a
// hand-maintained array of tenanted table names rotted: a table added after
// the array was written got no row level security policy, silently. A
// hand-maintained array here would rot the exact same way, except the failure
// mode is worse than a leak -- it is "delete my account" leaving some of that
// person's rows behind forever, which is a GDPR complaint waiting to happen
// and impossible to notice from the UI (the app just looks deleted).
//
// So this reads the same tenancy metadata src/db/__tests__/tenancy.test.ts
// already enforces stays exhaustive: every table in the drizzle schema that
// declares a `userId` column. A table added to the schema tomorrow is swept
// up here automatically, with no edit to this file, the same guarantee 0064
// gives row level security.
//
// user_identities is excluded for the same reason 0064 excludes it from RLS:
// it carries a userId column that is a Phase 1 foreign key, not Phase 2
// tenancy, and it is deleted explicitly below rather than through the loop
// because the `users` row itself must be the very last thing removed.
import { eq, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, type AnyPgColumn } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import { OWNER_USER_ID, userIdentities, users } from "@/db/schema";
import { withUser, type UserScopedDb } from "@/db/with-user";
import { deleteCredentials } from "@/lib/sync/credentials";
import type { UserId } from "@/lib/user-id";

/** Every drizzle table that carries a userId column, excluding identity. */
function tenantedTables(): PgTable[] {
  return Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((value) => value as PgTable)
    .filter((table) => table !== userIdentities)
    .filter((table) => "userId" in getTableColumns(table));
}

/**
 * Thrown when someone tries to delete the account resolveOwner() names as the
 * owner (see lib/owner.ts). Kept as a distinct type so the route can turn it
 * into a specific, actionable 409 rather than a generic failure.
 */
export class OwnerCannotSelfDeleteError extends Error {
  constructor() {
    super(
      "The owner account cannot delete itself: Kadenz's installation-level " +
        "Garmin worker (GARMIN_WORKER_URL/GARMIN_WORKER_TOKEN) has no owner " +
        "to fall back to, and the owner row is seeded by a fixed id " +
        "(OWNER_USER_ID) that nothing recreates automatically."
    );
  }
}

/**
 * Deletes `userId`'s account and every row it owns, irreversibly.
 *
 * ── The owner guard ───────────────────────────────────────────────────────
 *
 * OWNER_USER_ID is a fixed constant seeded by drizzle/0051_users.sql, not a
 * row that gets recreated if it disappears, and the Garmin push worker
 * (src/lib/sync/garmin-sync.ts) is a single installation-wide integration
 * configured entirely by env vars (GARMIN_WORKER_URL/GARMIN_WORKER_TOKEN) --
 * it has no concept of "which user is the Garmin owner" beyond whichever
 * account is running Kadenz day to day, which is always this one. Deleting
 * it would not just lose data; it would silently strand a worker with
 * nothing left to push, and there is no re-signup path back to the same
 * fixed id. So this is refused outright, before anything is touched, rather
 * than guarded by a confirmation string a misclick could still satisfy.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * Every delete below is filtered by `userId` -- the caller's own id, resolved
 * by the route from the session, never taken from a request body or param --
 * and runs inside withUser(userId, ...), so row level security enforces the
 * same boundary a second time even if a filter here were ever wrong. See
 * FORCE ROW LEVEL SECURITY in drizzle/0064.
 */
export async function deleteAccount(userId: UserId): Promise<void> {
  if (userId === OWNER_USER_ID) {
    throw new OwnerCannotSelfDeleteError();
  }

  await withUser(userId, async (tx: UserScopedDb) => {
    // Revoked explicitly and first, inside this user's row level security
    // context. deleteCredentials calls the module-level `db` handle rather
    // than `tx` directly, but db/index.ts's proxy resolves that to whatever
    // transaction the current AsyncLocalStorage store holds (see the long
    // note in db/with-user.ts) -- which, this deep in withUser's callback, is
    // this one. Calling it OUTSIDE withUser would run on the pooled
    // connection with no app.user_id set, and integration_credentials is
    // FORCE row-level-secured (drizzle/0064): a delete with no context
    // matches zero rows and silently "succeeds" at revoking nothing.
    //
    // integration_credentials also carries a userId column, so the generic
    // sweep below would remove these rows anyway -- this call is kept
    // explicit and first because "revoke the credentials" is a named
    // requirement of account deletion, not an accident of a table happening
    // to be tenanted, and it reads that way even if the sweep's table list
    // ever changes.
    await deleteCredentials(userId, "strava");
    await deleteCredentials(userId, "google");

    // Order does not matter for referential integrity: every FK among these
    // tables that points at another tenanted table is ON DELETE CASCADE
    // (plans -> weeks -> workouts -> blocks, strengthSessions -> strengthSets,
    // customWorkoutTemplates -> customWorkoutSlots -- see schema.ts), so
    // deleting a parent first removes its children for free and deleting a
    // child that a cascade already removed simply matches zero rows. What
    // does matter is that every one of these tables is scoped to `userId`
    // and runs under that user's row level security context, which the loop
    // and withUser above both guarantee independently.
    for (const table of tenantedTables()) {
      const userIdColumn = getTableColumns(table).userId as AnyPgColumn;
      await tx.delete(table).where(eq(userIdColumn, userId));
    }

    // Identity rows next: they are how a future login by the same Strava or
    // Google account would otherwise resolve straight back to this (deleted)
    // user id via resolveUserForLogin's lookup. Deleting them means the same
    // OAuth account signs up as a brand new user if they ever come back.
    await tx.delete(userIdentities).where(eq(userIdentities.userId, userId));

    // The user row itself, last. It carries no tenancy column of its own --
    // see tenancy.test.ts's EXCLUDED_TABLES -- so it is not row-level-secured
    // and has to be scoped by its own id explicitly rather than inheriting
    // the guarantee the loop above relies on.
    await tx.delete(users).where(eq(users.id, userId));
  });
}

// Exposed for tests: the exhaustiveness this module leans on is the same one
// tenancy.test.ts already enforces, but a direct assertion here catches a
// mismatch between "what has a userId column" and "what this module deletes"
// without needing to read two files to see it.
export function tenantedTableNamesForTest(): string[] {
  return tenantedTables()
    .map((t) => getTableName(t))
    .sort();
}
