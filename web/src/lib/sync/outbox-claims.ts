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
