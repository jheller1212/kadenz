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
// Every row in the database today belongs to one athlete, and Phase 2 of the
// multi-user plan attributes all of it to a single user: OWNER_USER_ID. So
// when that athlete logs in, the login has to resolve to that same user, or
// he would land in an empty app.
//
// The FIRST entry of each allowlist is defined to be the owner's account. It
// is deterministic (no "whoever logs in first wins" race), needs no new
// configuration, and is already true of both env vars, which hold exactly one
// entry each. Reordering either list would hand the owner's data to a
// different account, so append new testers, never prepend them.
//
// Any other allowlisted account resolves to its own user with no data, which
// is correct but not yet safe to hand out: cross-user isolation is Phase 3,
// and until it ships the allowlists should keep holding only the owner.

/** The owner's Strava athlete id, or null if the allowlist is unset. */
export function ownerStravaAthleteId(): string | null {
  return parseAllowlist(process.env.KADENZ_ALLOWED_STRAVA_ATHLETE_IDS)[0] ?? null;
}

/** The owner's Google email (lowercased), or null if the allowlist is unset. */
export function ownerGoogleEmail(): string | null {
  const first = parseAllowlist(process.env.KADENZ_ALLOWED_GOOGLE_EMAILS)[0];
  return first ? first.toLowerCase() : null;
}
