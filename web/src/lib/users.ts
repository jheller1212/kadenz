import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { OWNER_USER_ID, userIdentities, users } from "@/db/schema";
import { asUserId, type UserId } from "@/lib/user-id";

export type AuthProvider = "strava" | "google";

export type LoginIdentity = {
  provider: AuthProvider;
  /** Strava athlete id, or the Google subject claim. Never the email. */
  providerAccountId: string;
  email?: string | null;
  displayName?: string | null;
  /**
   * Whether this is the account Kadenz's existing data belongs to (see
   * ownerStravaAthleteId / ownerGoogleEmail in lib/owner.ts). The caller
   * decides this from configuration, so it can never be inferred from
   * whatever account happens to log in first.
   */
  isOwner: boolean;
};

/**
 * Resolves an OAuth login to the user it belongs to, creating the user and
 * the identity row the first time that account is seen.
 *
 * Callers must have checked the allowlist before calling this. It records who
 * someone is; it does not decide whether they are allowed in.
 */
export async function resolveUserForLogin(
  identity: LoginIdentity
): Promise<UserId> {
  const { provider, providerAccountId, isOwner } = identity;
  const email = identity.email?.trim().toLowerCase() || null;
  const displayName = identity.displayName?.trim() || null;

  const [existing] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.providerAccountId, providerAccountId)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(userIdentities)
      .set({ lastLoginAt: new Date(), ...(email ? { email } : {}) })
      .where(
        and(
          eq(userIdentities.provider, provider),
          eq(userIdentities.providerAccountId, providerAccountId)
        )
      );
    // The users table stores a plain uuid, so this is a boundary where a raw
    // column value becomes an identity. Validated rather than cast.
    return asUserId(existing.userId);
  }

  let userId: UserId;
  if (isOwner) {
    // Seeded by drizzle/0051_users.sql. Re-asserted here because the e2e
    // harness builds its database with `drizzle-kit push`, which creates the
    // tables but replays no migration, so the row would not otherwise exist.
    await db
      .insert(users)
      .values({ id: OWNER_USER_ID, email, displayName })
      .onConflictDoNothing();
    userId = asUserId(OWNER_USER_ID);
  } else {
    const [created] = await db
      .insert(users)
      .values({ email, displayName })
      .returning({ id: users.id });
    userId = asUserId(created.id);
  }

  // Upsert rather than insert so two logins racing the same first-ever sign-in
  // both end up on whichever user row won, instead of one of them failing on
  // the unique index.
  const [linked] = await db
    .insert(userIdentities)
    .values({
      userId,
      provider,
      providerAccountId,
      email,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.providerAccountId],
      set: { lastLoginAt: new Date() },
    })
    .returning({ userId: userIdentities.userId });

  return asUserId(linked.userId);
}

/**
 * Every user Kadenz knows about.
 *
 * The background jobs need this. A cron run carries no session, and until
 * Phase 4 it did not need one: every integration it touched was a single global
 * row, so "the athlete" was whoever those rows belonged to. Now that tokens and
 * the import bookmark are per user, a job has to be told whose work it is
 * doing, and this is the list it iterates.
 *
 * This is a stopgap with a known replacement. Phase 3 introduces forEachUser in
 * db/with-user.ts, which iterates the same list AND runs each iteration inside
 * that user's row level security context, which this cannot do. When phase 3
 * lands, callers of this move to forEachUser and this function goes away.
 * Keeping two ways to loop over users is exactly how a fan-out ends up doing
 * the work of one athlete twice, so do not build anything new on it.
 */
export async function listAllUserIds(): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((r) => r.id);
}
