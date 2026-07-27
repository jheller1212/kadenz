import { db, syncOutbox, workouts, strengthSessions } from "@/db";
import { eq, and, asc, or, lt, isNull } from "drizzle-orm";
import { STALE_CLAIM_MS, isMootFailure } from "./outbox-claims";
import {
  createEvent,
  patchEvent,
  deleteEvent,
  createStrengthEvent,
  patchStrengthEvent,
} from "./gcal-client";
import type { WorkoutEventInput, StrengthEventInput } from "./gcal-client";
import { buildPlannedSession } from "@/lib/strength/service";
import type { StrengthSessionType } from "@/lib/strength/types";

const MAX_ATTEMPTS = 3;

// ── Queue helpers ─────────────────────────────────────────────────────────────

export async function queueWorkoutSync(
  workoutId: string,
  action: "create" | "update" | "delete",
  target: "gcal" | "garmin" = "gcal",
  payload?: Record<string, unknown>
): Promise<void> {
  const idempotencyKey = `${target}:${action}:${workoutId}`;

  await db
    .insert(syncOutbox)
    .values({
      entityType: "workout",
      entityId: workoutId,
      action,
      target,
      status: "pending",
      idempotencyKey,
      payload: payload ?? null,
      attempts: 0,
    })
    .onConflictDoUpdate({
      // Re-arm an existing row: a completed job for this key must not swallow
      // a LATER change to the same entity (that left calendars permanently
      // stale). Mirrors the garmin outbox.
      target: syncOutbox.idempotencyKey,
      set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        processedAt: null,
        claimedAt: null,
      },
    });

  // Fire-and-forget flush
  processGCalOutbox().catch(console.error);
}

/**
 * Queue calendar deletions for a set of already-known workout events. Used when
 * a plan is regenerated: the old workouts (and their gcalEventIds) are about to
 * be removed, so their calendar events must be pruned by id.
 */
export async function queueWorkoutEventDeletes(
  events: Array<{ workoutId: string; gcalEventId: string }>,
  target: "gcal" | "garmin" = "gcal"
): Promise<void> {
  if (events.length === 0) return;
  const rows = events.map((e) => ({
    entityType: "workout" as const,
    entityId: e.workoutId,
    action: "delete" as const,
    target,
    status: "pending" as const,
    idempotencyKey: `${target}:delete:${e.workoutId}`,
    payload: { gcalEventId: e.gcalEventId } as Record<string, unknown>,
    attempts: 0,
  }));
  await db
    .insert(syncOutbox)
    .values(rows)
    .onConflictDoUpdate({
      // Re-arm an existing row: a completed job for this key must not swallow
      // a LATER change to the same entity (that left calendars permanently
      // stale). Mirrors the garmin outbox.
      target: syncOutbox.idempotencyKey,
      set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        processedAt: null,
        claimedAt: null,
      },
    });
  processGCalOutbox().catch(console.error);
}

export async function queuePlanWorkoutsSync(
  planId: string,
  target: "gcal" | "garmin" = "gcal",
  // Optional explicit set of workout ids to push (e.g. after a regenerate
  // that preserved some workouts untouched — those must not be re-queued as
  // a "create", which would push a duplicate event). Undefined keeps the
  // original behavior of pushing every workout on the plan.
  workoutIds?: string[]
): Promise<void> {
  const planWorkouts = workoutIds
    ? workoutIds.map((wid) => ({ id: wid }))
    : await db.select({ id: workouts.id }).from(workouts).where(eq(workouts.planId, planId));

  if (planWorkouts.length === 0) return;

  const rows = planWorkouts.map((w) => ({
    entityType: "workout" as const,
    entityId: w.id,
    action: "create" as const,
    target,
    status: "pending" as const,
    idempotencyKey: `${target}:create:${w.id}`,
    attempts: 0,
  }));

  // Batch insert all, skip existing idempotency keys
  await db
    .insert(syncOutbox)
    .values(rows)
    .onConflictDoUpdate({
      // Re-arm an existing row: a completed job for this key must not swallow
      // a LATER change to the same entity (that left calendars permanently
      // stale). Mirrors the garmin outbox.
      target: syncOutbox.idempotencyKey,
      set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        processedAt: null,
        claimedAt: null,
      },
    });

  // Fire-and-forget flush
  processGCalOutbox().catch(console.error);
}

export async function queueStrengthSessionSync(
  sessionId: string,
  action: "create" | "update" | "delete",
  target: "gcal" | "garmin" = "gcal",
  payload?: Record<string, unknown>
): Promise<void> {
  const idempotencyKey = `${target}:strength:${action}:${sessionId}`;

  await db
    .insert(syncOutbox)
    .values({
      entityType: "strength_session",
      entityId: sessionId,
      action,
      target,
      status: "pending",
      idempotencyKey,
      payload: payload ?? null,
      attempts: 0,
    })
    .onConflictDoUpdate({
      // Re-arm an existing row: a completed job for this key must not swallow
      // a LATER change to the same entity (that left calendars permanently
      // stale). Mirrors the garmin outbox.
      target: syncOutbox.idempotencyKey,
      set: {
        status: "pending",
        attempts: 0,
        lastError: null,
        processedAt: null,
        claimedAt: null,
      },
    });

  processGCalOutbox().catch(console.error);
}

// ── Fetch workout with blocks for event creation ──────────────────────────────

async function fetchWorkoutForSync(workoutId: string): Promise<WorkoutEventInput | null> {
  const row = await db.query.workouts.findFirst({
    where: (w, { eq }) => eq(w.id, workoutId),
    with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });

  if (!row) return null;

  return {
    workoutId: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    targetKm: row.targetKm,
    targetDurationMinutes: row.targetDurationMinutes,
    timeOfDay: row.timeOfDay,
    type: row.type,
    blocks: row.blocks.map((b) => ({
      type: b.type,
      durationMinutes: b.durationMinutes,
      distanceKm: b.distanceKm,
      targetPaceSecKm: b.targetPaceSecKm,
      reps: b.reps,
      repDistanceKm: b.repDistanceKm,
    })),
  };
}

// ── Process outbox ────────────────────────────────────────────────────────────

export interface SyncResult {
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

export async function processGCalOutbox(): Promise<SyncResult> {
  const result: SyncResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await resetStaleClaims("gcal");

  // Fetch pending gcal jobs with remaining attempts
  const jobs = await db
    .select()
    .from(syncOutbox)
    .where(
      and(
        eq(syncOutbox.target, "gcal"),
        eq(syncOutbox.status, "pending")
      )
    )
    .orderBy(asc(syncOutbox.createdAt))
    .limit(50);

  for (const job of jobs) {
    result.processed++;

    // Mark as processing
    await db
      .update(syncOutbox)
      .set({ status: "processing", attempts: job.attempts + 1, claimedAt: new Date() })
      .where(eq(syncOutbox.id, job.id));

    try {
      await processJob(job);

      await db
        .update(syncOutbox)
        .set({ status: "completed", processedAt: new Date() })
        .where(eq(syncOutbox.id, job.id));

      result.succeeded++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const newAttempts = job.attempts + 1;
      // A vanished entity or already-deleted calendar event is a settled
      // outcome, not a transient error — drop it instead of retrying to the cap.
      const nextStatus = isMootFailure(errorMsg)
        ? "completed"
        : newAttempts >= MAX_ATTEMPTS
        ? "failed"
        : "pending";

      await db
        .update(syncOutbox)
        .set({
          status: nextStatus,
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

async function fetchStrengthSessionForSync(
  sessionId: string
): Promise<StrengthEventInput | null> {
  const row = await db.query.strengthSessions.findFirst({
    where: (s, { eq }) => eq(s.id, sessionId),
  });
  if (!row) return null;

  // Build the SAME plan the athlete sees — with their complaints, loads,
  // duration and history — so the calendar/watch description matches the app
  // instead of a generic base session (was buildSessionPlan with no context).
  const { exercises: plan } = await buildPlannedSession(
    row.type as StrengthSessionType,
    row.date,
    row.profileId
  );
  return {
    sessionId: row.id,
    title: row.title,
    date: row.date,
    type: row.type,
    targetDurationMinutes: row.targetDurationMinutes,
    exercises: plan.map((p) => ({
      name: p.name,
      prescription: p.prescription,
      suggestedWeightKg: p.suggestedWeightKg,
      perSide: p.perSide,
      dumbbells: p.dumbbells,
      holdNote: p.holdNote,
    })),
  };
}

async function processStrengthJob(
  job: typeof syncOutbox.$inferSelect
): Promise<void> {
  const sessionId = job.entityId;

  if (job.action === "delete") {
    const payload = job.payload as { gcalEventId?: string } | null;
    if (payload?.gcalEventId) await deleteEvent(payload.gcalEventId);
    return;
  }

  const session = await fetchStrengthSessionForSync(sessionId);
  if (!session) throw new Error(`Strength session ${sessionId} not found`);

  const [current] = await db
    .select({ gcalEventId: strengthSessions.gcalEventId })
    .from(strengthSessions)
    .where(eq(strengthSessions.id, sessionId));

  if (current?.gcalEventId) {
    await patchStrengthEvent(current.gcalEventId, session);
  } else {
    const gcalEventId = await createStrengthEvent(session);
    await db
      .update(strengthSessions)
      .set({ gcalEventId })
      .where(eq(strengthSessions.id, sessionId));
  }
}

async function processJob(
  job: typeof syncOutbox.$inferSelect
): Promise<void> {
  if (job.entityType === "strength_session") {
    await processStrengthJob(job);
    return;
  }
  if (job.entityType !== "workout") return;

  const workoutId = job.entityId;

  if (job.action === "create") {
    const workout = await fetchWorkoutForSync(workoutId);
    if (!workout) throw new Error(`Workout ${workoutId} not found`);

    const gcalEventId = await createEvent(workout);

    // Store the gcal event ID back on the workout
    await db
      .update(workouts)
      .set({ gcalEventId })
      .where(eq(workouts.id, workoutId));
  } else if (job.action === "update") {
    const workout = await fetchWorkoutForSync(workoutId);
    if (!workout) throw new Error(`Workout ${workoutId} not found`);

    // Get current gcal event ID
    const [current] = await db
      .select({ gcalEventId: workouts.gcalEventId })
      .from(workouts)
      .where(eq(workouts.id, workoutId));

    if (!current?.gcalEventId) {
      // No existing event — create instead
      const gcalEventId = await createEvent(workout);
      await db
        .update(workouts)
        .set({ gcalEventId })
        .where(eq(workouts.id, workoutId));
    } else {
      await patchEvent(current.gcalEventId, workout);
    }
  } else if (job.action === "delete") {
    const payload = job.payload as { gcalEventId?: string } | null;
    const gcalEventId = payload?.gcalEventId;
    if (gcalEventId) {
      await deleteEvent(gcalEventId);
    }
  }
}

// ── Stale-claim reaper ───────────────────────────────────────────────────────

/**
 * Return jobs abandoned mid-flight to "pending". Without this a killed
 * invocation leaves a row in "processing" forever, and because its
 * idempotency key still exists it also swallows every later enqueue for
 * that entity.
 */
export async function resetStaleClaims(target: "gcal" | "garmin"): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const rows = await db
    .update(syncOutbox)
    .set({ status: "pending", claimedAt: null })
    .where(
      and(
        eq(syncOutbox.target, target),
        eq(syncOutbox.status, "processing"),
        or(isNull(syncOutbox.claimedAt), lt(syncOutbox.claimedAt, cutoff))
      )
    )
    .returning({ id: syncOutbox.id });
  if (rows.length > 0) {
    console.warn(`Reset ${rows.length} stale ${target} outbox job(s)`);
  }
  return rows.length;
}
