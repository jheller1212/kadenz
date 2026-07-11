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
