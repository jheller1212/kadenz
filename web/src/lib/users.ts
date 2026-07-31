import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { OWNER_USER_ID, userIdentities, users } from "@/db/schema";
import { asUserId, type UserId } from "@/lib/user-id";

export type AuthProvider = "strava" | "google" | "email";

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
 * Resolves a consumed email magic-link to the user it belongs to. Deliberately
 * separate from resolveUserForLogin rather than a third branch inside it: the
 * decision here -- may this create a new account, and may it attach to an
 * account another provider already created -- has no equivalent for Strava or
 * Google, both of which are pure "match or create" with no merge step.
 *
 * `isOwner` from LoginIdentity is not accepted here on purpose. A magic link
 * proves control of an inbox, nothing more, and the owner allowlist exists
 * precisely because an OAuth login (or an email login) on its own is not
 * proof of being Jonas. This path can never mint a session over the owner's
 * data -- see OWNER_USER_ID below, never referenced.
 *
 * ── The merge decision ───────────────────────────────────────────────────────
 * If this exact address already signed in by email before, it is the same
 * returning user: log in, no gate check (closing sign-up later must not lock
 * out someone who already has an account).
 *
 * If this address has never signed in by email but DOES match the email on
 * an existing Google identity (Google verifies its id_token's email before
 * ever reaching resolveUserForLogin -- see the callback route), the link is
 * attached to that SAME user rather than creating a second one. This is the
 * one deliberate case where a magic link is allowed to reach an account
 * created by another provider: the address has now been proven twice, once
 * by Google's verified id_token and once by this link, which is strictly
 * more assurance than either proof alone, and the alternative -- a Google
 * user who later tries email sign-in getting a second, empty account -- is
 * worse for a real athlete than it is safer for anyone else. If more than one
 * user shares the address (edge case: two Google identities recorded the
 * same email at different times), this refuses to guess and creates a new
 * account instead, the same fail-closed shape as resolveOwner in owner.ts.
 *
 * Otherwise: a genuinely new address, gated by isEmailSignupOpen().
 */
export async function resolveUserForEmailLogin(
  email: string,
  signupOpen: boolean
): Promise<UserId> {
  const normalized = email.trim().toLowerCase();

  const [existingEmailIdentity] = await db
    .select({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, "email"),
        eq(userIdentities.providerAccountId, normalized)
      )
    )
    .limit(1);

  if (existingEmailIdentity) {
    await db
      .update(userIdentities)
      .set({ lastLoginAt: new Date() })
      .where(
        and(
          eq(userIdentities.provider, "email"),
          eq(userIdentities.providerAccountId, normalized)
        )
      );
    return asUserId(existingEmailIdentity.userId);
  }

  const otherIdentitiesForEmail = await db
    .selectDistinct({ userId: userIdentities.userId })
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.email, normalized),
        // Only a provider that verifies the email before recording it. Today
        // that is Google; Strava never supplies one (resolveUserForLogin is
        // called with email undefined for it), so this can only ever match a
        // Google identity in practice, but is written against "provider !=
        // email" rather than "provider = google" so the reasoning covers
        // Apple sign-in too once it lands (both verify server-side, per
        // NATIVE_APP_PLAN.md).
        ne(userIdentities.provider, "email")
      )
    )
    .limit(2);

  let userId: UserId;
  if (otherIdentitiesForEmail.length === 1) {
    // Exactly one existing account claims this verified email -- attach.
    userId = asUserId(otherIdentitiesForEmail[0].userId);
  } else {
    // Zero matches (new address) or two-plus (ambiguous, refuse to guess):
    // a fresh account, subject to the signup gate.
    if (!signupOpen) {
      throw new EmailSignupClosedError();
    }
    const [created] = await db
      .insert(users)
      .values({ email: normalized })
      .returning({ id: users.id });
    userId = asUserId(created.id);
  }

  await db
    .insert(userIdentities)
    .values({
      userId,
      provider: "email",
      providerAccountId: normalized,
      email: normalized,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userIdentities.provider, userIdentities.providerAccountId],
      set: { lastLoginAt: new Date() },
    });

  return userId;
}

/** Thrown by resolveUserForEmailLogin when the address is new and sign-up is closed. */
export class EmailSignupClosedError extends Error {
  constructor() {
    super("Email sign-up is not open yet.");
  }
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
