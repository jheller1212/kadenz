// ── Prompt outbox delivery for a plan change ─────────────────────────────────
// A plan create/regenerate/archive queues sync rows (see plan-retire.ts and
// the callers below) but queuing alone doesn't put anything on Google
// Calendar or the watch — something has to drain the outbox. Historically
// that drain was a bare unawaited promise ("fire and forget"): the platform
// is free to freeze a serverless invocation the instant its response is
// sent, and a frozen drain never runs. That is the exact failure mode that
// silently dropped the strength schedule in #54 (an unawaited insert loop),
// now applied to delivery instead of writes — so it gets the same fix.
//
// after() (Next 15+) schedules a callback to run once the response has been
// sent, and the platform keeps the invocation alive until it finishes
// instead of freezing on response-out. That's what actually closes the gap:
// the athlete's request isn't slowed down (no full drain awaited inline —
// see the timing budget in timing.ts and the #54 postmortem), but the drain
// is no longer a coin flip either.

import { after } from "next/server";
import { processGCalOutbox } from "./sync-manager";
import { processGarminOutbox, queueGarminStrengthWindowSync } from "./garmin-sync";
import { isConnected } from "./gcal-client";
import { isGarminWorkoutSyncEnabled } from "./garmin-config";

/**
 * Top up the Garmin side of the strength schedule, then drain both outboxes.
 * Awaited body used from inside an after() callback — exported separately
 * from scheduleOutboxDrain() so a caller that also needs to queue
 * plan-specific rows first (POST /api/plans, PUT /api/plans/[id]) can do
 * that queueing and this drain inside ONE after() callback, guaranteeing the
 * drain runs after the rows it's meant to pick up actually exist. Next does
 * not guarantee execution order across separate after() registrations.
 *
 * reconcileStrengthSchedule only ever queues newly-placed sessions to the
 * gcal target (see schedule.ts) — without the strength top-up here, a
 * rebuilt plan's strength sessions wouldn't reach the watch until the next
 * cron top-up.
 *
 * Safe to call concurrently with itself, with the daily cron
 * (/api/cron/gcal), and with the 15-minute safety-net cron
 * (/api/cron/sync-drain) — claimJobs() in sync-manager.ts claims outbox rows
 * with `FOR UPDATE SKIP LOCKED`, so overlapping drains can never process the
 * same row twice.
 */
export async function drainOutboxNow(userId: string): Promise<void> {
  // `userId` is only needed for the two QUEUEING decisions below: whether this
  // person has watch sync on, and whether they have a calendar connected. The
  // drains themselves take no user, because an outbox row already records its
  // own owner and each job is delivered with that owner's credentials. Passing
  // a user into the drain would be the wrong shape: one request's drain
  // legitimately picks up rows queued by anyone, since it claims whatever is
  // pending with FOR UPDATE SKIP LOCKED.
  try {
    if (await isGarminWorkoutSyncEnabled(userId)) {
      await queueGarminStrengthWindowSync(userId);
    }
  } catch (err) {
    console.error("Failed to queue Garmin strength top-up:", err);
  }

  const drains: Promise<unknown>[] = [processGarminOutbox()];
  try {
    if (await isConnected(userId)) drains.push(processGCalOutbox());
  } catch (err) {
    console.error("gcal connection check failed:", err);
  }

  const settled = await Promise.allSettled(drains);
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.error("Post-plan-change outbox drain failed:", outcome.reason);
    }
  }
}

/**
 * Register drainOutboxNow() to run after the response is sent. Call this
 * synchronously from a route handler (not from inside an unawaited
 * `.then()`) — after() only extends the invocation's lifetime for work it
 * knows about at the point it's called. Use this directly when there is
 * nothing plan-specific left to queue (e.g. DELETE /api/plans/[id], which
 * already awaited its deletes before returning); otherwise call
 * drainOutboxNow() yourself inside your own after() callback, after your
 * queueing.
 */
export function scheduleOutboxDrain(userId: string): void {
  after(() => drainOutboxNow(userId));
}
