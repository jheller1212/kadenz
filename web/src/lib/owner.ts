// Owner allowlist for OAuth login.
//
// Kadenz started as a single-user personal app: the session cookie grants
// full read/write access to its holder's own training data and stored
// Strava/Google tokens (never anyone else's -- see db/with-user.ts). OAuth on
// its own only proves the visitor controls *some* Strava or Google account,
// not that they are allowed in at all. Without an identity check, any
// stranger who completes OAuth would be minted a valid session. These helpers
// bind login to an explicit owner allowlist -- and, for Google only, to the
// isGoogleSignupOpen() switch below that lets sign-up open beyond it.
//
// Fail closed: an unset or empty allowlist rejects everyone, and sign-up
// being open is opt-in, never inferred. The env vars must be set in
// production before login can succeed -- that is intentional, so a
// misconfiguration can never silently fall back to "let anyone in".

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

// ── Opening Google sign-up ────────────────────────────────────────────────────
//
// The multi-user plan requires the leak audit and RLS to be done before
// anyone but the owner can sign up (see MULTI_USER_PLAN.md / PLAN_OF_ATTACK.md
// 2.5). Both landed, so Google sign-up can open -- but it opens behind its own
// switch rather than by widening the allowlist, for two reasons: an allowlist
// entry is permanent until someone edits it and redeploys, while this reads an
// env var on every request, so Jonas can turn sign-up back off from the host's
// dashboard, with no deploy, the moment something looks wrong. And unlike the
// allowlist (identity, checked once at login) this is a pure feature flag, so
// keeping it separate means flipping it can never accidentally change who the
// owner is -- see resolveOwner below, which does not read this at all.
//
// Default closed, same rule as the allowlist itself: an unset or unrecognised
// value must reject rather than admit, so a missing env var in a fresh
// deploy fails safe instead of open.
export function isGoogleSignupOpen(): boolean {
  return process.env.KADENZ_GOOGLE_SIGNUP_OPEN === "true";
}

/**
 * True if `email` may sign in with Google: either it is on
 * KADENZ_ALLOWED_GOOGLE_EMAILS, or sign-up is open (see isGoogleSignupOpen).
 * Strava has no such switch -- it stays allowlist-only until it gets the same
 * review this had.
 */
export function isAllowedGoogleEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (isGoogleSignupOpen()) return true;
  const allowed = parseAllowlist(process.env.KADENZ_ALLOWED_GOOGLE_EMAILS).map(
    (entry) => entry.toLowerCase()
  );
  if (allowed.length === 0) return false; // fail closed
  return allowed.includes(email.toLowerCase());
}

/** True only if `athleteId` is on KADENZ_ALLOWED_STRAVA_ATHLETE_IDS. */
export function isAllowedStravaAthleteId(
  athleteId: number | null | undefined
): boolean {
  if (athleteId == null) return false;
  const allowed = parseAllowlist(process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS);
  if (allowed.length === 0) return false; // fail closed
  return allowed.includes(String(athleteId));
}

// ── Which allowlisted account is the owner ───────────────────────────────────
//
// Every row in the database belongs to one athlete, and Phase 2 of the
// multi-user plan attributes all of it to a single user: OWNER_USER_ID. So
// when that athlete logs in, the login has to resolve to that same user, or he
// lands in an empty app. Everyone else gets their own user and no data.
//
// This is the highest-stakes decision in the login path. Resolving as the
// owner means a session over all of Jonas's training data and stored tokens,
// so it is stated explicitly in KADENZ_OWNER_STRAVA_ID and
// KADENZ_OWNER_GOOGLE_EMAIL rather than inferred from the allowlists. The
// allowlists stay what they have always been: access control, who may log in
// at all. They say nothing about whose data it is, and nothing ties a position
// in one list to the same person's position in the other.
//
// Fallback, so this deploys without a config change: if the explicit var is
// unset AND the matching allowlist holds exactly one account, that account is
// the owner. That is unambiguous and is true of both env vars today.
//
// Fail closed the moment it stops being unambiguous. An unset explicit var
// with two or more allowlisted accounts returns null, and the callback turns
// that into a loud configuration error instead of guessing. Guessing wrong
// here would hand a tester the owner's entire history.

function resolveOwner(explicitVar: string | undefined, allowlist: string[]): string | null {
  const explicit = (explicitVar ?? "").trim();
  if (explicit) return explicit;
  return allowlist.length === 1 ? allowlist[0] : null;
}

/**
 * The owner's Strava athlete id, or null if it cannot be determined without
 * guessing (see above). Null is a configuration error, not "no owner".
 */
export function ownerStravaAthleteId(): string | null {
  return resolveOwner(
    process.env.KADENZ_OWNER_STRAVA_ID,
    parseAllowlist(process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS)
  );
}

/** The owner's Google email (lowercased), or null. Same rules as above. */
export function ownerGoogleEmail(): string | null {
  const owner = resolveOwner(
    process.env.KADENZ_OWNER_GOOGLE_EMAIL,
    parseAllowlist(process.env.KADENZ_ALLOWED_GOOGLE_EMAILS)
  );
  return owner ? owner.toLowerCase() : null;
}
