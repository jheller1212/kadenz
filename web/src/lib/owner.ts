// Owner allowlist for OAuth login.
//
// Kadenz is a single-user personal app: the session cookie grants full
// read/write access to all training data and to the stored Strava/Google
// tokens. OAuth on its own only proves the visitor controls *some* Strava or
// Google account, not that they are the owner. Without an identity check, any
// stranger who completes OAuth would be minted a valid session. These helpers
// bind the session to an explicit owner allowlist.
//
// Fail closed: an unset or empty allowlist rejects everyone. The env vars must
// be set in production before login can succeed — that is intentional, so a
// misconfiguration can never silently fall back to "let anyone in".

function parseAllowlist(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** True only if `email` is on KADENZ_ALLOWED_GOOGLE_EMAILS (case-insensitive). */
export function isAllowedGoogleEmail(email: string | null | undefined): boolean {
  if (!email) return false;
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
