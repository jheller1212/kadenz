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
import { asUserId } from "@/lib/user-id";

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
 *
 * Returns whether both drains completed without throwing, so a caller that
 * fans this out over every user (cron/sync-drain) can tell a real failure
 * apart from "nothing to do" and surface it as a non-2xx response. Callers
 * that fire this from inside after() (plans routes) run after the response
 * is already sent and have nothing to report the result to, so they ignore
 * it — which is fine, since a failure here is still logged either way.
 */
export async function drainOutboxNow(userId: string): Promise<{ ok: boolean }> {
  // `userId` picks two things: whose pending rows each drain claims (see
  // processGCalOutbox / processGarminOutbox — one transaction can only carry
  // one app.user_id, so each drain is scoped to this person's own queue, not
  // "whatever is pending" the way it used to be), and the two QUEUEING
  // decisions below (does this person have watch sync on, do they have a
  // calendar connected).
  const uid = asUserId(userId);

  try {
    if (await isGarminWorkoutSyncEnabled(userId)) {
      await queueGarminStrengthWindowSync(userId);
    }
  } catch (err) {
    console.error("Failed to queue Garmin strength top-up:", err);
  }

  const drains: Promise<unknown>[] = [processGarminOutbox(uid)];
  try {
    if (await isConnected(userId)) drains.push(processGCalOutbox(uid));
  } catch (err) {
    console.error("gcal connection check failed:", err);
  }

  const settled = await Promise.allSettled(drains);
  let ok = true;
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      console.error("Post-plan-change outbox drain failed:", outcome.reason);
      ok = false;
    }
  }
  return { ok };
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
