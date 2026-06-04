import { db, syncOutbox, workouts } from "@/db";
import { eq, and, asc } from "drizzle-orm";
import { createEvent, patchEvent, deleteEvent } from "./gcal-client";
import type { WorkoutEventInput } from "./gcal-client";

const MAX_ATTEMPTS = 3;

// ── Queue helpers ─────────────────────────────────────────────────────────────

export async function queueWorkoutSync(
  workoutId: string,
  action: "create" | "update" | "delete",
  target: "gcal" | "garmin" = "gcal"
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
      attempts: 0,
    })
    .onConflictDoNothing({ target: syncOutbox.idempotencyKey });

  // Fire-and-forget flush
  processGCalOutbox().catch(console.error);
}

export async function queuePlanWorkoutsSync(
  planId: string,
  target: "gcal" | "garmin" = "gcal"
): Promise<void> {
  const planWorkouts = await db
    .select({ id: workouts.id })
    .from(workouts)
    .where(eq(workouts.planId, planId));

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
    .onConflictDoNothing({ target: syncOutbox.idempotencyKey });

  // Fire-and-forget flush
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
      .set({ status: "processing", attempts: job.attempts + 1 })
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
      const nextStatus = newAttempts >= MAX_ATTEMPTS ? "failed" : "pending";

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

async function processJob(
  job: typeof syncOutbox.$inferSelect
): Promise<void> {
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
