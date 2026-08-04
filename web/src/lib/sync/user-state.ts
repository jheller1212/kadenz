// Small per-user sync bookkeeping: the Garmin import bookmark, the watch-sync
// toggle, and whatever comes next of that shape.
//
// This replaces the loadSingleton/saveSingleton pair in garmin-config.ts, which
// addressed one row of sync_outbox by a fixed idempotency key. That column is
// UNIQUE table-wide, so there was exactly one row per key for the entire
// installation. For the import bookmark that is actively harmful under a
// per-user import: every iteration wrote its own position into the same row, so
// the next user's import started from wherever the previous user's finished and
// each athlete either re-imported weeks of activities or skipped the ones
// recorded since their own last run, depending on who ran last.

import { db, userIntegrationState } from "@/db";
import { and, eq } from "drizzle-orm";

/**
 * Keys are namespaced by integration so one reader cannot read another's blob.
 * "google:connection" records why an athlete's Google Calendar was
 * auto-disconnected (see markGCalDisconnected in gcal-client.ts) — present
 * only while that's true, cleared the moment a fresh OAuth round-trip saves
 * new tokens.
 */
export type UserStateKey = "garmin:import" | "garmin:config" | "google:connection";

/**
 * `userId`'s value for `key`, or null if they have none.
 *
 * A user who has never run an import has no bookmark, which is why null is a
 * normal answer and every caller supplies its own default. Query failures
 * return null too, so a database blip reads as "no bookmark" and the import
 * falls back to its default lookback rather than failing the whole cron run.
 */
export async function loadUserState<T>(
  userId: string,
  key: UserStateKey
): Promise<T | null> {
  try {
    const [row] = await db
      .select({ value: userIntegrationState.value })
      .from(userIntegrationState)
      .where(
        and(
          eq(userIntegrationState.userId, userId),
          eq(userIntegrationState.key, key)
        )
      )
      .limit(1);

    if (!row?.value) return null;
    return row.value as unknown as T;
  } catch {
    return null;
  }
}

/** Stores `value` as `userId`'s value for `key`. */
export async function saveUserState(
  userId: string,
  key: UserStateKey,
  value: Record<string, unknown>
): Promise<void> {
  await db
    .insert(userIntegrationState)
    .values({ userId, key, value })
    .onConflictDoUpdate({
      // The table's primary key. Two users advancing the same bookmark key now
      // land on two rows instead of fighting over one.
      target: [userIntegrationState.userId, userIntegrationState.key],
      set: { value, updatedAt: new Date() },
    });
}

/** Forgets `userId`'s value for `key`. A no-op (not an error) if there is none. */
export async function clearUserState(userId: string, key: UserStateKey): Promise<void> {
  await db
    .delete(userIntegrationState)
    .where(and(eq(userIntegrationState.userId, userId), eq(userIntegrationState.key, key)));
}
