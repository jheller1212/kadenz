// ── Retire a plan's sync artifacts (both surfaces) ──────────────────────────
// A plan that is replaced or deleted leaves its pushed workouts behind on
// Google Calendar and the watch unless something explicitly prunes them.
// This is that something — one place both the "new plan replaces old" path
// and the "delete a plan" path call, so neither can forget one surface.

import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db, plans, workouts, syncOutbox } from "@/db";
import { queueWorkoutEventDeletes } from "./sync-manager";
import { isConnected } from "./gcal-client";
import { queueGarminWorkoutDeletes } from "./garmin-sync";
import { garminClient } from "./garmin-client";
import { buildRetireDeleteBatch, type RetireCandidateWorkout } from "./plan-retire-rules";

export type { RetireCandidateWorkout } from "./plan-retire-rules";
export { buildRetireDeleteBatch } from "./plan-retire-rules";

export interface RetireResult {
  gcalQueued: number;
  garminQueued: number;
}

/**
 * Queue deletes for both surfaces from rows the caller already has in hand.
 * Does NOT touch the workout rows — use this when the caller is about to
 * delete/replace those rows itself (e.g. plan regeneration, which cascades
 * the old weeks away right after capturing their ids).
 *
 * Awaited by every caller: this only performs the (fast) outbox INSERTs, not
 * the actual network delete — that flush stays fire-and-forget via the
 * queue* helpers, and the daily cron drains anything a frozen invocation
 * left pending. Awaiting the insert is what makes the delete durable instead
 * of a bare unawaited promise that a serverless freeze can silently drop.
 */
export async function queueRetireDeletes(rows: RetireCandidateWorkout[]): Promise<RetireResult> {
  // A workout being retired may still have an earlier pending create/update
  // job sitting in the outbox (e.g. queued before the plan was archived, or
  // from before this retire path existed). Left pending, reconnecting a
  // currently-broken integration later would push it right back — the exact
  // pile this exists to prevent. Cancel those before queueing the deletes
  // below, so a job that's about to be dead-on-arrival never gets the chance.
  await cancelPendingOutboxForWorkouts(rows.map((r) => r.id));

  const { gcalDeletes, garminDeletes } = buildRetireDeleteBatch(rows);

  let gcalQueued = 0;
  let garminQueued = 0;

  if (gcalDeletes.length > 0 && (await isConnected())) {
    await queueWorkoutEventDeletes(gcalDeletes);
    gcalQueued = gcalDeletes.length;
  }
  if (garminDeletes.length > 0 && garminClient.isConfigured()) {
    await queueGarminWorkoutDeletes(garminDeletes);
    garminQueued = garminDeletes.length;
  }

  return { gcalQueued, garminQueued };
}

/**
 * Retire every synced workout still attached to a plan: queue calendar +
 * watch deletes for both, then clear the stored ids so nothing stale is left
 * for a later sync to misread as still-live. Call this whenever a plan
 * leaves "active" without its rows being deleted outright (archive-on-create,
 * explicit archive) — a row that's about to be cascade-deleted instead
 * (regenerate-in-place) should use queueRetireDeletes directly.
 */
export async function retirePlanSyncArtifacts(planId: string): Promise<RetireResult> {
  // Every workout on the plan, NOT just the ones with a stored surface id.
  // A workout whose gcal/garmin create job never ran (e.g. queued while the
  // calendar integration was down) has no id yet, but the pending job for it
  // must still be cancelled here — otherwise it's exactly the kind of stale
  // job that piles up and floods the calendar the moment sync comes back.
  const rows = await db
    .select({
      id: workouts.id,
      gcalEventId: workouts.gcalEventId,
      garminWorkoutId: workouts.garminWorkoutId,
    })
    .from(workouts)
    .where(eq(workouts.planId, planId));

  if (rows.length === 0) return { gcalQueued: 0, garminQueued: 0 };

  // Clear first (mirrors skip-week): the delete jobs below carry the ids they
  // need in their payload, so clearing early just means nothing else — a
  // concurrent move, another retire — can read these ids as still live while
  // the deletes are in flight. A no-op for rows that had no id to begin with.
  await db
    .update(workouts)
    .set({ gcalEventId: null, garminWorkoutId: null })
    .where(
      inArray(
        workouts.id,
        rows.map((r) => r.id)
      )
    );

  return queueRetireDeletes(rows);
}

/**
 * Repair path: find workouts belonging to already-archived plans that still
 * carry a stale gcal/garmin id (plans replaced before this fix existed, or
 * cleanup that never landed because of a frozen invocation) and retire them.
 * Never touches an active plan's workouts — the archived-status filter is
 * the whole guard. Re-runnable: once a row's ids are cleared it no longer
 * matches, so a second run finds nothing and queues nothing twice.
 */
export async function reconcileArchivedPlanSyncArtifacts(): Promise<{
  plansAffected: number;
  workoutsAffected: number;
  gcalQueued: number;
  garminQueued: number;
}> {
  const rows = await selectArchivedPlanArtifactRows();
  if (rows.length === 0) {
    return { plansAffected: 0, workoutsAffected: 0, gcalQueued: 0, garminQueued: 0 };
  }

  const plansAffected = new Set(rows.map((r) => r.planId)).size;

  await db
    .update(workouts)
    .set({ gcalEventId: null, garminWorkoutId: null })
    .where(
      inArray(
        workouts.id,
        rows.map((r) => r.id)
      )
    );

  const { gcalQueued, garminQueued } = await queueRetireDeletes(rows);

  return { plansAffected, workoutsAffected: rows.length, gcalQueued, garminQueued };
}

/** Same query as the reconcile, without mutating anything — lets the owner
 * see how many rows/plans would be touched before actually running it. */
export async function previewArchivedPlanSyncArtifacts(): Promise<{
  plansAffected: number;
  workoutsAffected: number;
}> {
  const rows = await selectArchivedPlanArtifactRows();
  return {
    plansAffected: new Set(rows.map((r) => r.planId)).size,
    workoutsAffected: rows.length,
  };
}

async function selectArchivedPlanArtifactRows(): Promise<
  Array<RetireCandidateWorkout & { planId: string }>
> {
  return db
    .select({
      id: workouts.id,
      planId: workouts.planId,
      gcalEventId: workouts.gcalEventId,
      garminWorkoutId: workouts.garminWorkoutId,
    })
    .from(workouts)
    .innerJoin(plans, eq(workouts.planId, plans.id))
    .where(
      and(
        eq(plans.status, "archived"),
        or(isNotNull(workouts.gcalEventId), isNotNull(workouts.garminWorkoutId))
      )
    );
}

/**
 * Cancel any still-PENDING outbox job (either surface) for the given workout
 * ids. Moves them to the "cancelled" terminal status rather than deleting the
 * rows, so the outbox keeps an auditable record of what got swept and why.
 * A job already "processing"/"completed"/"failed" is left alone — this only
 * ever intercepts work that hasn't been attempted yet.
 */
async function cancelPendingOutboxForWorkouts(workoutIds: string[]): Promise<number> {
  if (workoutIds.length === 0) return 0;
  const cancelled = await db
    .update(syncOutbox)
    .set({ status: "cancelled", processedAt: new Date() })
    .where(
      and(
        eq(syncOutbox.entityType, "workout"),
        inArray(syncOutbox.entityId, workoutIds),
        eq(syncOutbox.status, "pending")
      )
    )
    .returning({ id: syncOutbox.id });
  return cancelled.length;
}
