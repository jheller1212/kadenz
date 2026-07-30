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

import { db, integrationCredentials } from "@/db";
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
 * loaders had — a database blip must not present as "your account is
 * disconnected and needs re-authorising" in a way that makes someone re-run
 * OAuth for nothing, but it must equally not stop the rest of a sync run.
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
 * The conflict target is (user_id, provider), which is the whole fix: two
 * people connecting the same service land on two rows. `providerAccountId` is
 * the external account id where the provider gives us one, so an incoming
 * webhook can find its way back to this row.
 */
export async function saveCredentials(
  userId: string,
  provider: IntegrationProvider,
  payload: Record<string, unknown>,
  providerAccountId?: string | null
): Promise<void> {
  await db
    .insert(integrationCredentials)
    .values({
      userId,
      provider,
      providerAccountId: providerAccountId ?? null,
      payload,
    })
    .onConflictDoUpdate({
      target: [integrationCredentials.userId, integrationCredentials.provider],
      set: {
        payload,
        // Only overwrite the account id when this write actually knows one, so
        // a token refresh (which carries no account id) cannot blank out the
        // value the webhook lookup depends on.
        ...(providerAccountId ? { providerAccountId } : {}),
        updatedAt: new Date(),
      },
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
 * The user who connected the `provider` account identified by
 * `providerAccountId`, or null if nobody has.
 *
 * This exists for the Strava webhook, which is the one caller with no session:
 * its event body names the athlete and nothing else. Without this it had no
 * way to tell whose activity an event described, and with a single global token
 * row it did not need one — it always acted as the installation's only user.
 * Returning null (rather than falling back to the owner) is deliberate: an
 * event for an athlete nobody has connected must be ignored, not attributed to
 * whoever happens to be first in the table.
 */
export async function findUserByProviderAccount(
  provider: IntegrationProvider,
  providerAccountId: string
): Promise<string | null> {
  const [row] = await db
    .select({ userId: integrationCredentials.userId })
    .from(integrationCredentials)
    .where(
      and(
        eq(integrationCredentials.provider, provider),
        eq(integrationCredentials.providerAccountId, providerAccountId)
      )
    )
    .limit(1);

  return row?.userId ?? null;
}

/**
 * Everyone who has connected `provider`.
 *
 * The background jobs need this because a cron run has no session and can no
 * longer assume there is exactly one athlete to work for. Phase 5 turns the
 * loops themselves into proper fan-out; this is the list they iterate.
 */
export async function listUsersWithProvider(
  provider: IntegrationProvider
): Promise<string[]> {
  const rows = await db
    .select({ userId: integrationCredentials.userId })
    .from(integrationCredentials)
    .where(eq(integrationCredentials.provider, provider));

  return [...new Set(rows.map((r) => r.userId))];
}
