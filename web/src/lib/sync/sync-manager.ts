import { db, syncOutbox, workouts, strengthSessions } from "@/db";
import { eq, and, or, lt, isNull, sql } from "drizzle-orm";
import { asUserId } from "@/lib/user-id";
import { withUser, type UserId } from "@/db/with-user";
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
import { loadUserUnits } from "@/lib/user-units";
import type { StrengthSessionType } from "@/lib/strength/types";

const MAX_ATTEMPTS = 3;

// ── Queue helpers ─────────────────────────────────────────────────────────────

export async function queueWorkoutSync(
  workoutId: string,
  action: "create" | "update" | "delete",
  userId: UserId,
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
      userId,
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

  // Fire-and-forget flush, scoped to this job's own owner (see processGCalOutbox).
  processGCalOutbox(userId).catch(console.error);
}

/**
 * Queue calendar deletions for a set of already-known workout events. Used when
 * a plan is regenerated: the old workouts (and their gcalEventIds) are about to
 * be removed, so their calendar events must be pruned by id.
 */
export async function queueWorkoutEventDeletes(
  events: Array<{ workoutId: string; gcalEventId: string }>,
  userId: UserId,
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
    userId,
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
  processGCalOutbox(userId).catch(console.error);
}

export async function queuePlanWorkoutsSync(
  planId: string,
  userId: UserId,
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
    userId,
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
  processGCalOutbox(userId).catch(console.error);
}

export async function queueStrengthSessionSync(
  sessionId: string,
  action: "create" | "update" | "delete",
  userId: UserId,
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
      userId,
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

  processGCalOutbox(userId).catch(console.error);
}

// ── Fetch workout with blocks for event creation ──────────────────────────────

async function fetchWorkoutForSync(workoutId: string): Promise<WorkoutEventInput | null> {
  const row = await db.query.workouts.findFirst({
    where: (w, { eq }) => eq(w.id, workoutId),
    with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
  });

  if (!row) return null;

  // The event summary and description are rebuilt in the owner's unit, so the
  // calendar stops being the one place in Kadenz still quoting km to a miles
  // athlete. One primary-key lookup per job.
  const { distanceUnit } = await loadUserUnits(asUserId(row.userId));

  return {
    workoutId: row.id,
    distanceUnit,
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

/**
 * Atomically claim up to `limit` pending jobs for a target BELONGING TO ONE
 * USER, ordering deletes ahead of everything else. A stale entry left on the
 * watch/calendar by a replaced plan is far more confusing than a new one
 * arriving a few seconds late, so clearing it wins the race for outbox slots.
 *
 * `userId` is an explicit filter, not just a courtesy — this must be called
 * from inside that same user's `withUser` scope (see processGCalOutbox /
 * processGarminOutbox below) so row level security also restricts the claim
 * to their rows. The filter here is the query-plan optimisation RLS's own
 * doc comment asks for; RLS is what makes it impossible to get wrong.
 *
 * The claim is a single UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
 * LOCKED) so two drains running at once (the daily cron, the 15-minute
 * safety-net cron, and an immediate post-plan-change drain can all overlap)
 * can never pick up the same row: Postgres locks each candidate for the
 * duration of the subquery, and SKIP LOCKED makes the second drain skip past
 * rows the first already grabbed instead of blocking on them. The previous
 * select-then-update-by-id sequence had no such guarantee — a row selected
 * by two concurrent drains before either claimed it would have been
 * processed twice.
 */
export async function claimJobs(
  target: "gcal" | "garmin",
  userId: UserId,
  limit = 50
): Promise<Array<typeof syncOutbox.$inferSelect>> {
  const rows = await db.execute<typeof syncOutbox.$inferSelect>(sql`
    UPDATE sync_outbox
    SET status = 'processing', attempts = attempts + 1, claimed_at = now()
    WHERE id IN (
      SELECT id FROM sync_outbox
      WHERE target = ${target} AND status = 'pending' AND user_id = ${userId}
      ORDER BY (action = 'delete') DESC, created_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING
      id,
      entity_type AS "entityType",
      entity_id AS "entityId",
      action,
      target,
      payload,
      status,
      idempotency_key AS "idempotencyKey",
      attempts,
      last_error AS "lastError",
      created_at AS "createdAt",
      processed_at AS "processedAt",
      claimed_at AS "claimedAt",
      user_id AS "userId"
  `);
  return Array.from(rows as unknown as Array<typeof syncOutbox.$inferSelect>);
}

// One transaction can carry exactly one app.user_id (db/with-user.ts), and an
// outbox drain is genuinely cross-user by design — a claim has to span
// whoever has jobs pending, not one caller's rows. Those two facts don't fit
// together in a single query, so the drain is reshaped to match the caller's
// own userId, one person at a time: claim only that user's pending rows
// (claimJobs' explicit user_id filter, backed by row level security), process
// them, then let the caller loop this over every user via forEachUser — the
// same shape every other cron route already uses (see cron/gcal). See
// PER_USER_CLAIM_LIMIT below for how a single user's backlog is kept from
// starving everyone drained in the same pass.
export async function processGCalOutbox(userId: UserId): Promise<SyncResult> {
  return withUser(userId, () => drainGCalOutboxForUser(userId));
}

// Bounds how much of one drain call a single user's backlog can consume.
// forEachUser visits every user on every pass regardless of any one person's
// queue depth, so — unlike the old shared, table-wide LIMIT 50 that a single
// prolific user's rows could exhaust before anyone else got a slot — this cap
// only ever limits that ONE user's own claim. Fairness therefore falls out of
// the per-user loop by construction, not from tuning this number. It exists
// only to bound how long any one user's transaction stays open (see the "what
// this costs" note in db/with-user.ts): a backlog deeper than this drains over
// the next pass instead — drainOutboxNow fires after every plan change plus
// the 15-minute safety-net cron, so it never waits long.
const PER_USER_CLAIM_LIMIT = 50;

async function drainGCalOutboxForUser(userId: UserId): Promise<SyncResult> {
  const result: SyncResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  await resetStaleClaims("gcal", userId);

  const jobs = await claimJobs("gcal", userId, PER_USER_CLAIM_LIMIT);

  for (const job of jobs) {
    result.processed++;

    try {
      await processJob(job);

      await db
        .update(syncOutbox)
        .set({ status: "completed", processedAt: new Date() })
        .where(eq(syncOutbox.id, job.id));

      result.succeeded++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // claimJobs already incremented attempts as part of the atomic claim.
      const newAttempts = job.attempts;
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
    row.profileId,
    undefined,
    [],
    undefined,
    undefined,
    undefined,
    // A started session's frozen complaints, so the calendar description
    // keeps matching what the athlete is actually doing.
    row.complaints,
    // Whether the rehab-day scheduler attached Achilles/HSR work to this
    // specific session — the calendar description must include it too.
    row.achillesAttached
  );
  // The description lists every exercise's load, so it needs the owner's
  // weight unit for the same reason the run event needs the distance unit.
  const { weightUnit } = await loadUserUnits(asUserId(row.userId));

  return {
    sessionId: row.id,
    weightUnit,
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
    if (payload?.gcalEventId) await deleteEvent(job.userId, payload.gcalEventId);
    return;
  }

  const session = await fetchStrengthSessionForSync(sessionId);
  if (!session) throw new Error(`Strength session ${sessionId} not found`);

  const [current] = await db
    .select({ gcalEventId: strengthSessions.gcalEventId })
    .from(strengthSessions)
    .where(eq(strengthSessions.id, sessionId));

  if (current?.gcalEventId) {
    await patchStrengthEvent(job.userId, current.gcalEventId, session);
  } else {
    const gcalEventId = await createStrengthEvent(job.userId, session);
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

    const gcalEventId = await createEvent(job.userId, workout);

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
      const gcalEventId = await createEvent(job.userId, workout);
      await db
        .update(workouts)
        .set({ gcalEventId })
        .where(eq(workouts.id, workoutId));
    } else {
      await patchEvent(job.userId, current.gcalEventId, workout);
    }
  } else if (job.action === "delete") {
    const payload = job.payload as { gcalEventId?: string } | null;
    const gcalEventId = payload?.gcalEventId;
    if (gcalEventId) {
      await deleteEvent(job.userId, gcalEventId);
    }
  }
}

// ── Stale-claim reaper ───────────────────────────────────────────────────────

/**
 * Return jobs abandoned mid-flight to "pending". Without this a killed
 * invocation leaves a row in "processing" forever, and because its
 * idempotency key still exists it also swallows every later enqueue for
 * that entity.
 *
 * Scoped to one user for the same reason claimJobs is — must run inside that
 * user's `withUser` scope, filtered explicitly here to match.
 */
export async function resetStaleClaims(
  target: "gcal" | "garmin",
  userId: UserId
): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS);
  const rows = await db
    .update(syncOutbox)
    .set({ status: "pending", claimedAt: null })
    .where(
      and(
        eq(syncOutbox.target, target),
        eq(syncOutbox.status, "processing"),
        eq(syncOutbox.userId, userId),
        or(isNull(syncOutbox.claimedAt), lt(syncOutbox.claimedAt, cutoff))
      )
    )
    .returning({ id: syncOutbox.id });
  if (rows.length > 0) {
    console.warn(`Reset ${rows.length} stale ${target} outbox job(s)`);
  }
  return rows.length;
}
