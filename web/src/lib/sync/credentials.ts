// One person's OAuth credentials for one external service.
//
// Before Phase 4, Strava and Google tokens each lived in a single row of
// sync_outbox under a fixed idempotency key, which is UNIQUE across the table.
// The upsert in saveTokens() could therefore only ever produce one row for the
// whole installation, so the second person to complete OAuth overwrote the
// first person's tokens. That is worse than a read leak: the first person's
// sync kept running and started acting on the second person's Strava account.
//
// Everything that reads or writes a token goes through this module, so
// "which user's tokens" is a required argument at the only place it could be
// got wrong, rather than a fact about which row happened to be there.

import { db, integrationCredentials, userIdentities } from "@/db";
import { and, eq } from "drizzle-orm";

export type IntegrationProvider = "strava" | "google";

/**
 * The credentials `userId` stored for `provider`, or null when that person has
 * not connected the service.
 *
 * Null is a normal answer, not an error: a user who enters workouts by hand
 * never connects anything, and every caller has to degrade rather than throw
 * (an unconnected calendar means "do not queue calendar events", not a 500).
 * A failed query also returns null, matching the behaviour the singleton
 * loaders had. A database blip must not stop the rest of a sync run, and it
 * must equally not be presented to someone as "your account is disconnected"
 * in a way that makes them re-run OAuth for nothing.
 */
export async function loadCredentials<T>(
  userId: string,
  provider: IntegrationProvider
): Promise<T | null> {
  try {
    const [row] = await db
      .select({ payload: integrationCredentials.payload })
      .from(integrationCredentials)
      .where(
        and(
          eq(integrationCredentials.userId, userId),
          eq(integrationCredentials.provider, provider)
        )
      )
      .limit(1);

    if (!row?.payload) return null;
    return row.payload as unknown as T;
  } catch {
    return null;
  }
}

/**
 * Stores `payload` as `userId`'s credentials for `provider`, replacing whatever
 * they had before.
 *
 * The conflict target is (user_id, provider), and that is the whole fix: two
 * people connecting the same service land on two rows instead of fighting over
 * the installation's only one.
 */
export async function saveCredentials(
  userId: string,
  provider: IntegrationProvider,
  payload: Record<string, unknown>
): Promise<void> {
  await db
    .insert(integrationCredentials)
    .values({ userId, provider, payload })
    .onConflictDoUpdate({
      target: [integrationCredentials.userId, integrationCredentials.provider],
      set: { payload, updatedAt: new Date() },
    });
}

/** Forgets `userId`'s connection to `provider`. Disconnect, not delete-account. */
export async function deleteCredentials(
  userId: string,
  provider: IntegrationProvider
): Promise<void> {
  await db
    .delete(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.userId, userId),
        eq(integrationCredentials.provider, provider)
      )
    );
}

/**
 * The user who owns the `provider` account identified by `providerAccountId`,
 * or null if nobody does.
 *
 * This exists for the Strava webhook, the one caller with no session: its event
 * body names the athlete (owner_id) and nothing else, so the athlete id is the
 * only identity it has. With a single global token row it did not need one, it
 * always acted as the installation's only user.
 *
 * It reads user_identities rather than this module's own table, and that choice
 * matters for two reasons beyond reusing an index that already exists.
 *
 * First, correctness under row level security. This lookup necessarily runs
 * BEFORE any user context is established, since establishing it is the whole
 * point of the call. Tenanted tables answer such a read with nothing, so
 * resolving the athlete against a tenanted credentials table would return null
 * for every event and the webhook would silently stop working. user_identities
 * is identity rather than a user's data, carries no policy by design, and is
 * already read this way.
 *
 * Second, it keeps one fact in one place. Connecting Strava in Kadenz IS
 * logging in with Strava (see api/auth/strava/callback), so the identity row
 * always exists for a connected athlete. Storing the athlete id a second time
 * next to the tokens would give the same fact two homes that can drift.
 *
 * Returning null rather than falling back to the owner is deliberate: an event
 * for an athlete nobody has connected must be ignored, not attributed to
 * whoever happens to be first in the table.
 */
export async function findUserByProviderAccount(
  provider: IntegrationProvider,
  providerAccountId: string
): Promise<string | null> {
  const [row] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.providerAccountId, providerAccountId)
      )
    )
    .limit(1);

  return row?.userId ?? null;
}
