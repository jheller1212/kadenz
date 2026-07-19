// ── Garmin workout fan-out (outbox pattern, mirrors sync-manager's gcal path) ─
// Run workouts within the next GARMIN_WINDOW_DAYS are pushed to the watch via
// the garmin-worker. Everything is queued through sync_outbox (target "garmin")
// so retries and the daily cron top-up reuse the same machinery as gcal.

import { db, syncOutbox, workouts, plans, strengthSessions } from "@/db";
import { eq, and, asc, gte, lte, ne, isNull } from "drizzle-orm";
import { garminClient, toGarminDate } from "./garmin-client";
import { isGarminWorkoutSyncEnabled } from "./garmin-config";
import type { SyncResult } from "./sync-manager";
import { resetStaleClaims } from "./sync-manager";
import { buildPlannedSession } from "@/lib/strength/service";
import type { StrengthSessionType } from "@/lib/strength/types";

const MAX_ATTEMPTS = 3;

/** Only push workouts this many days out — the whole plan would flood the
 * Garmin calendar. The daily cron rolls the window forward. */
export const GARMIN_WINDOW_DAYS = 14;

// ── Queue helpers ─────────────────────────────────────────────────────────────

/**
 * Queue a Garmin reschedule after a workout moved. Self-gating:
 * - already pushed (garminWorkoutId set) → move it, even if the toggle is now
 *   off (otherwise the Garmin calendar goes stale);
 * - not pushed yet → push it only when sync is enabled and the new date landed
 *   inside the rolling window.
 * Uses an upsert so a second move after the first completed re-queues instead
 * of no-oping on the idempotency key.
 */
export async function queueGarminWorkoutMove(workoutId: string): Promise<void> {
  if (!garminClient.isConfigured()) return;

  const [row] = await db
    .select({
      garminWorkoutId: workouts.garminWorkoutId,
      date: workouts.date,
      type: workouts.type,
      status: workouts.status,
    })
    .from(workouts)
    .where(eq(workouts.id, workoutId))
    .limit(1);
  if (!row || row.type === "rest") return;

  if (!row.garminWorkoutId) {
    if (!(await isGarminWorkoutSyncEnabled())) return;
    if (row.status !== "planned") return;
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + GARMIN_WINDOW_DAYS);
    if (row.date > windowEnd || row.date < startOfToday()) return;
  }

  await db
    .insert(syncOutbox)
    .values({
      entityType: "workout",
      entityId: workoutId,
      action: row.garminWorkoutId ? "update" : "create",
      target: "garmin",
      status: "pending",
      idempotencyKey: row.garminWorkoutId
        ? `garmin:update:${workoutId}`
        : `garmin:create:${workoutId}`,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { status: "pending", attempts: 0, lastError: null },
    });
  processGarminOutbox().catch(console.error);
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Queue Garmin deletions for workouts that are being removed (plan regenerate
 * or archive). Pass the garmin ids explicitly — the rows may already be gone
 * by the time the job runs. */
export async function queueGarminWorkoutDeletes(
  items: Array<{ workoutId: string; garminWorkoutId: string }>
): Promise<void> {
  if (items.length === 0) return;
  for (const item of items) {
    await db
      .insert(syncOutbox)
      .values({
        entityType: "workout",
        entityId: item.workoutId,
        action: "delete",
        target: "garmin",
        status: "pending",
        idempotencyKey: `garmin:delete:${item.workoutId}`,
        payload: { garminWorkoutId: item.garminWorkoutId },
        attempts: 0,
      })
      .onConflictDoUpdate({
        target: syncOutbox.idempotencyKey,
        set: {
          status: "pending",
          attempts: 0,
          lastError: null,
          payload: { garminWorkoutId: item.garminWorkoutId },
        },
      });
  }
  processGarminOutbox().catch(console.error);
}

/**
 * Queue Garmin pushes for upcoming run workouts inside the rolling window.
 * Idempotent: workouts already pushed (garminWorkoutId set) or already queued
 * (idempotency key) are skipped, so both plan creation and the daily cron can
 * call this freely. Pass a planId to scope to one plan; omit for all active.
 */
export async function queueGarminWindowSync(planId?: string): Promise<number> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + GARMIN_WINDOW_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  const conditions = [
    gte(workouts.date, windowStart),
    lte(workouts.date, windowEnd),
    ne(workouts.type, "rest"),
    eq(workouts.status, "planned"),
    isNull(workouts.garminWorkoutId),
    eq(plans.status, "active"),
  ];
  if (planId) conditions.push(eq(workouts.planId, planId));

  const upcoming = await db
    .select({ id: workouts.id })
    .from(workouts)
    .innerJoin(plans, eq(workouts.planId, plans.id))
    .where(and(...conditions));

  if (upcoming.length === 0) return 0;

  await db
    .insert(syncOutbox)
    .values(
      upcoming.map((w) => ({
        entityType: "workout" as const,
        entityId: w.id,
        action: "create" as const,
        target: "garmin" as const,
        status: "pending" as const,
        idempotencyKey: `garmin:create:${w.id}`,
        attempts: 0,
      }))
    )
    .onConflictDoNothing({ target: syncOutbox.idempotencyKey });

  processGarminOutbox().catch(console.error);
  return upcoming.length;
}

// ── Process outbox ────────────────────────────────────────────────────────────

/**
 * Queue upcoming strength sessions for the watch. Same 14-day rolling window
 * as runs — the worker turns each planned exercise into a Garmin strength
 * step with sets, reps and load.
 */
export async function queueGarminStrengthWindowSync(): Promise<number> {
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setDate(windowEnd.getDate() + GARMIN_WINDOW_DAYS);
  windowEnd.setHours(23, 59, 59, 999);

  const upcoming = await db
    .select({ id: strengthSessions.id })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, windowStart),
        lte(strengthSessions.date, windowEnd),
        eq(strengthSessions.status, "planned"),
        isNull(strengthSessions.garminWorkoutId),
        // Owner only — a household member's sessions aren't on this watch.
        isNull(strengthSessions.profileId)
      )
    );

  if (upcoming.length === 0) return 0;

  await db
    .insert(syncOutbox)
    .values(
      upcoming.map((sess) => ({
        entityType: "strength_session" as const,
        entityId: sess.id,
        action: "create" as const,
        target: "garmin" as const,
        status: "pending" as const,
        idempotencyKey: `garmin:strength:create:${sess.id}`,
        attempts: 0,
      }))
    )
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { status: "pending", attempts: 0, lastError: null, claimedAt: null },
    });

  processGarminOutbox().catch(console.error);
  return upcoming.length;
}

/** Re-push a strength session after its date or contents changed. */
export async function queueGarminStrengthMove(sessionId: string): Promise<void> {
  if (!garminClient.isConfigured()) return;

  const [row] = await db
    .select({
      garminWorkoutId: strengthSessions.garminWorkoutId,
      date: strengthSessions.date,
      status: strengthSessions.status,
      profileId: strengthSessions.profileId,
    })
    .from(strengthSessions)
    .where(eq(strengthSessions.id, sessionId))
    .limit(1);
  if (!row || row.profileId !== null) return;

  if (!row.garminWorkoutId) {
    if (!(await isGarminWorkoutSyncEnabled())) return;
    if (row.status !== "planned") return;
    const windowEnd = new Date();
    windowEnd.setDate(windowEnd.getDate() + GARMIN_WINDOW_DAYS);
    if (row.date > windowEnd || row.date < startOfToday()) return;
  }

  await db
    .insert(syncOutbox)
    .values({
      entityType: "strength_session",
      entityId: sessionId,
      action: "update",
      target: "garmin",
      status: "pending",
      idempotencyKey: `garmin:strength:update:${sessionId}`,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { status: "pending", attempts: 0, lastError: null, claimedAt: null },
    });

  processGarminOutbox().catch(console.error);
}

/** Remove a strength session from the watch (pruned, trashed or rescheduled away). */
export async function queueGarminStrengthDelete(
  sessionId: string,
  garminWorkoutId: string
): Promise<void> {
  if (!garminClient.isConfigured()) return;

  await db
    .insert(syncOutbox)
    .values({
      entityType: "strength_session",
      entityId: sessionId,
      action: "delete",
      target: "garmin",
      status: "pending",
      idempotencyKey: `garmin:strength:delete:${sessionId}`,
      payload: { garminWorkoutId },
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { status: "pending", attempts: 0, lastError: null, claimedAt: null },
    });

  processGarminOutbox().catch(console.error);
}

export async function processGarminOutbox(): Promise<SyncResult> {
  await resetStaleClaims("garmin");

  const result: SyncResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };

  const jobs = await db
    .select()
    .from(syncOutbox)
    .where(and(eq(syncOutbox.target, "garmin"), eq(syncOutbox.status, "pending")))
    .orderBy(asc(syncOutbox.createdAt))
    .limit(50);

  for (const job of jobs) {
    result.processed++;
    await db
      .update(syncOutbox)
      .set({ status: "processing", attempts: job.attempts + 1, claimedAt: new Date() })
      .where(eq(syncOutbox.id, job.id));

    try {
      await processGarminJob(job);
      await db
        .update(syncOutbox)
        .set({ status: "completed", processedAt: new Date() })
        .where(eq(syncOutbox.id, job.id));
      result.succeeded++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = job.attempts + 1;
      await db
        .update(syncOutbox)
        .set({
          status: newAttempts >= MAX_ATTEMPTS ? "failed" : "pending",
          lastError: errorMsg,
          attempts: newAttempts,
        })
        .where(eq(syncOutbox.id, job.id));
      result.failed++;
      result.errors.push({ id: job.id, error: errorMsg });
    }
  }

  return result;
}

async function processGarminJob(job: typeof syncOutbox.$inferSelect): Promise<void> {
  if (job.entityType === "strength_session") {
    await processGarminStrengthJob(job);
    return;
  }
  if (job.entityType !== "workout") return;
  const workoutId = job.entityId;

  if (job.action === "delete") {
    const payload = job.payload as { garminWorkoutId?: string } | null;
    if (payload?.garminWorkoutId) {
      await garminClient.deleteWorkout(payload.garminWorkoutId);
    }
    return;
  }

  const row = await db.query.workouts.findFirst({
    where: (w, { eq }) => eq(w.id, workoutId),
    with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });
  if (!row) throw new Error(`Workout ${workoutId} not found`);
  // Rest days and already-completed workouts never go to the watch.
  if (row.type === "rest") return;

  const scheduledDate = toGarminDate(row.date);

  if (row.garminWorkoutId) {
    // Already on Garmin — a create/update job means "make the date right".
    await garminClient.moveWorkout(row.garminWorkoutId, scheduledDate);
    return;
  }

  if (row.status !== "planned") return;

  const garminWorkoutId = await garminClient.createWorkout({
    title: row.title,
    description: row.description,
    scheduledDate,
    blocks: row.blocks.map((b) => ({
      type: b.type,
      durationSeconds: b.durationMinutes != null ? b.durationMinutes * 60 : null,
      distanceMeters: b.distanceKm != null ? b.distanceKm * 1000 : null,
      targetPaceSecKm: b.targetPaceSecKm,
      minPaceSecKm: b.minPaceSecKm,
      maxPaceSecKm: b.maxPaceSecKm,
      reps: b.reps,
      repDistanceMeters: b.repDistanceKm != null ? b.repDistanceKm * 1000 : null,
      repRestSeconds: b.repRestSeconds,
    })),
  });

  await db
    .update(workouts)
    .set({ garminWorkoutId })
    .where(eq(workouts.id, workoutId));
}


// ── Strength sessions ────────────────────────────────────────────────────────

async function processGarminStrengthJob(
  job: typeof syncOutbox.$inferSelect
): Promise<void> {
  const sessionId = job.entityId;

  if (job.action === "delete") {
    const payload = job.payload as { garminWorkoutId?: string } | null;
    if (payload?.garminWorkoutId) {
      await garminClient.deleteWorkout(payload.garminWorkoutId);
    }
    return;
  }

  const [row] = await db
    .select()
    .from(strengthSessions)
    .where(eq(strengthSessions.id, sessionId))
    .limit(1);
  if (!row) throw new Error(`Strength session ${sessionId} not found`);
  if (row.profileId !== null) return;

  const scheduledDate = toGarminDate(row.date);

  if (row.garminWorkoutId) {
    // Already on the watch — a create/update job means "make the date right".
    await garminClient.moveWorkout(row.garminWorkoutId, scheduledDate);
    return;
  }

  if (row.status !== "planned") return;

  // The plan is derived, not stored: build it the same way the app does so the
  // watch shows the loads the athlete is actually meant to lift today.
  const planned = await buildPlannedSession(
    row.type as StrengthSessionType,
    row.date,
    row.profileId
  );
  const exercises = planned.map((ex) => ({
    name: ex.name,
    category: ex.category,
    sets: ex.sets,
    // Garmin wants a single rep target; the low end of the range is the
    // honest floor for a prescription like "8-12".
    reps: ex.repLow,
    weightKg: ex.suggestedWeightKg ?? ex.lastWeightKg ?? null,
  }));
  if (exercises.length === 0) return;

  const garminWorkoutId = await garminClient.pushStrengthWorkout({
    sessionId: row.id,
    title: row.title,
    date: row.date,
    exercises,
  });

  await db
    .update(strengthSessions)
    .set({ garminWorkoutId })
    .where(eq(strengthSessions.id, sessionId));
}
