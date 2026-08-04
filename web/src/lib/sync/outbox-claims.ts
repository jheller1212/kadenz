// Pure claim-staleness rules for the sync outbox. Kept free of DB imports so
// the logic is unit-testable.

/** A job claimed longer ago than this was abandoned mid-flight. */
export const STALE_CLAIM_MS = 10 * 60 * 1000;

/** True when a claimed job should be handed back to the queue. */
export function isStaleClaim(
  job: { status: string; claimedAt: Date | null },
  now: Date = new Date()
): boolean {
  if (job.status !== "processing") return false;
  // Legacy rows claimed before claimedAt existed are always reclaimable.
  if (!job.claimedAt) return true;
  return now.getTime() - job.claimedAt.getTime() > STALE_CLAIM_MS;
}

/**
 * True when a job can never succeed: its entity is gone, or the calendar event
 * it targets no longer exists. Retrying these forever only burns quota and
 * hides real failures behind a wall of noise.
 */
export function isMootFailure(errorMessage: string): boolean {
  const m = errorMessage.toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("404") ||
    m.includes("has been deleted") ||
    m.includes("resource has been deleted")
  );
}

/**
 * True specifically for a dead Google grant: `invalid_grant` means the
 * refresh token has been revoked (the athlete disconnected Kadenz from their
 * Google account, or Google expired it), and no amount of retrying will ever
 * exchange it for a new access token. This is the one case where
 * disconnecting the calendar and asking the athlete to reconnect is the
 * right, actionable response — see markGCalDisconnected in gcal-client.ts.
 */
export function isRevokedGCalGrant(errorMessage: string): boolean {
  return errorMessage.toLowerCase().includes("invalid_grant");
}

/**
 * True for any gcal failure that every remaining claimed job in the same
 * batch is about to hit identically: a revoked grant (above), or the OAuth
 * client itself being unconfigured (missing GOOGLE_CLIENT_ID/SECRET, thrown
 * by createOAuth2Client before any per-job work happens). Neither is fixed by
 * retrying — the first needs the athlete to reconnect, the second needs a
 * deploy config change — so once one is seen, the whole batch stops instead
 * of spending an outbound Google call (and the held transaction behind it,
 * see sync-manager.ts) to learn the same thing job after job.
 *
 * Deliberately narrower than "disconnect the athlete's calendar": a missing
 * env var affects every user identically and reconnecting cannot fix it, so
 * only isRevokedGCalGrant (not this) gates markGCalDisconnected.
 */
export function isPermanentGCalFailure(errorMessage: string): boolean {
  const m = errorMessage.toLowerCase();
  return (
    isRevokedGCalGrant(errorMessage) ||
    m.includes("google_client_id and google_client_secret must be set")
  );
}
