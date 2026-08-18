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
import { processGCalOutbox, resetStaleClaims } from "./sync-manager";
import { processGarminOutbox, queueGarminStrengthWindowSync } from "./garmin-sync";
import { isConnected } from "./gcal-client";
import { isGarminWorkoutSyncEnabled } from "./garmin-config";
import { asUserId } from "@/lib/user-id";
import { withUser } from "@/db/with-user";

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

  // ── Every gate below reads a TENANTED table, so every one needs a scope ────
  //
  // This function is called with no transaction open (see the sync-drain
  // route), which is deliberate: the drains it starts make outbound calls,
  // and those must not hold this instance's only connection. The cost is that
  // nothing here inherits an app.user_id any more, and under FORCE row level
  // security an unscoped read does not fail — it returns nothing. So a gate
  // asking "is watch sync on?" or "is the calendar connected?" answers a
  // confident, silent NO, and the work behind it never runs.
  //
  // Not hypothetical: it shipped. Removing the outer transaction left these
  // three reads bare, and for one deploy the calendar drain was skipped on
  // every run while the endpoint reported {"ok":true,"drained":1}.
  // withUser is reentrant, so wrapping is also correct on the after() paths
  // that already hold a scope.
  try {
    const garminEnabled = await withUser(uid, () => isGarminWorkoutSyncEnabled(userId));
    if (garminEnabled) {
      await withUser(uid, () => queueGarminStrengthWindowSync(uid));
    }
  } catch (err) {
    console.error("Failed to queue Garmin strength top-up:", err);
  }

  const drains: Promise<unknown>[] = [processGarminOutbox(uid)];
  try {
    if (await withUser(uid, () => isConnected(userId))) {
      drains.push(processGCalOutbox(uid));
    } else {
      // Disconnected, so there is nothing to deliver — but a row this user
      // had CLAIMED when the grant died is still sitting in `processing`,
      // and the only thing that ever releases one is resetStaleClaims, which
      // lives inside the drain being skipped here. Without this, such a row
      // is stranded until the calendar is reconnected: invisible to the
      // pending count, never retried, never failed. One was found stuck that
      // way for four days after an `invalid_grant` disconnect.
      //
      // Releasing it back to `pending` is the honest state: undelivered and
      // waiting, which is exactly what it is. Nothing drains it while
      // disconnected, and reconnecting picks it up.
      // Wrapped, and this is not optional: resetStaleClaims issues a bare
      // UPDATE, and sync-drain now calls this with NO transaction open (see
      // #173). Outside one there is no app.user_id, so under FORCE row level
      // security the statement matches zero rows and reports success — the
      // row stays stuck and nothing says so. withUser is reentrant, so this
      // is equally correct on the after() paths that DO already hold a scope.
      await withUser(uid, () => resetStaleClaims("gcal", uid));
    }
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
