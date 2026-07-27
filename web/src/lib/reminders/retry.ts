// Pure "should this already-claimed reminder be attempted again" decision —
// no DB, no fetch, mirrors due.ts's separation of the scheduling rule from
// the I/O that acts on it (see dispatch.ts).

export type SentReminderStatus = "pending" | "sent" | "failed" | "permanent";

export interface SentReminderRow {
  status: SentReminderStatus;
  attempts: number;
  lastAttemptAt: Date;
}

// Every 15 minutes, a persistently broken push service would otherwise retry
// forever; this bounds it to roughly an hour of attempts, comfortably inside
// most reminder lead times without hammering the push service indefinitely.
export const MAX_REMINDER_ATTEMPTS = 5;

// If a claim is left "pending" longer than this, the process that made it
// almost certainly died mid-send (serverless function killed, deploy cut it
// off) rather than being genuinely still in flight. Treating a stale pending
// claim as retryable — instead of leaving it claimed forever — is what
// guarantees a crash never silently costs the athlete their reminder.
export const STALE_PENDING_MS = 10 * 60 * 1000;

/**
 * Whether an already-claimed reminder (a row in sent_reminders) is eligible
 * for another send attempt right now.
 *
 * Both halves of the invariant live here:
 *   - never twice: "sent" is always terminal, and a fresh "pending" (an
 *     attempt genuinely in flight elsewhere) is not eligible either.
 *   - never silently lost to a blip: "failed" retries as long as the
 *     workout hasn't started and the attempt cap hasn't been hit; a claim
 *     stuck "pending" past STALE_PENDING_MS is treated the same as "failed"
 *     rather than being a permanent dead claim.
 */
export function isRetryEligible(row: SentReminderRow, now: Date, scheduledAt: Date): boolean {
  // Once the workout has started a "reminder" would be wrong, not late —
  // matches selectDueReminders' own window rule in due.ts.
  if (now.getTime() >= scheduledAt.getTime()) return false;

  if (row.status === "sent" || row.status === "permanent") return false;

  if (row.status === "pending") {
    return now.getTime() - row.lastAttemptAt.getTime() >= STALE_PENDING_MS;
  }

  // status === "failed"
  return row.attempts < MAX_REMINDER_ATTEMPTS;
}
