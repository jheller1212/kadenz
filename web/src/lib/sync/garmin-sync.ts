// ── Garmin workout fan-out (outbox pattern, mirrors sync-manager's gcal path) ─
// Run workouts within the next GARMIN_WINDOW_DAYS are pushed to the watch via
// the garmin-worker. Everything is queued through sync_outbox (target "garmin")
// so retries and the daily cron top-up reuse the same machinery as gcal.

import { db, syncOutbox, workouts, plans, strengthSessions } from "@/db";
import { eq, and, gte, lte, ne, isNull, isNotNull, inArray } from "drizzle-orm";
import { garminClient, toGarminDate } from "./garmin-client";
import { isGarminWorkoutSyncEnabled } from "./garmin-config";
import type { SyncResult } from "./sync-manager";
import { resetStaleClaims, claimJobs } from "./sync-manager";
import { rowsNeedingRepush } from "./garmin-heal";
import {
  buildAdoptionContext,
  resolveGarminWorkoutId,
  writeBackGarminId,
  type AdoptionContext,
} from "./garmin-adoption";
import {
  buildPlannedSession,
  getStrengthPlanSettingsRow,
  planDurationMinutesFromRow,
} from "@/lib/strength/service";
import { garminLabel, garminDescription, planWeekNumber } from "./garmin-label";
import { SESSION_TEMPLATES } from "@/lib/strength/program";
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
  if (!garminClient.isConfigured()) return;
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
  if (!garminClient.isConfigured()) return 0;
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
 *
 * Only sessions that belong to the ongoing plan (watchEligible — see
 * schema.ts) are swept here. A Kraft-picker "Start" or custom-workout
 * quick-start session must never reach the watch on its own; it only gets
 * there via the athlete's explicit "Send to watch" control, which is a
 * one-shot direct push (POST /sessions/[id]/garmin), not this queue.
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
        eq(strengthSessions.watchEligible, true),
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

/**
 * Re-push a strength session after its date or contents changed.
 *
 * Self-gating on two different things depending on whether it's already on
 * the watch:
 *   - already pushed (garminWorkoutId set, whether that happened via the
 *     plan window sync or the athlete's explicit "Send to watch") → always
 *     keep it in sync, regardless of watchEligible — once it's on the wrist
 *     it must not go stale;
 *   - not pushed yet → only push it if it's watchEligible (part of the
 *     ongoing plan). A Kraft-picker ad-hoc session must never get its first
 *     push from this path — see schema.ts strengthSessions.watchEligible.
 */
export async function queueGarminStrengthMove(sessionId: string): Promise<void> {
  if (!garminClient.isConfigured()) return;

  const [row] = await db
    .select({
      garminWorkoutId: strengthSessions.garminWorkoutId,
      date: strengthSessions.date,
      status: strengthSessions.status,
      profileId: strengthSessions.profileId,
      watchEligible: strengthSessions.watchEligible,
    })
    .from(strengthSessions)
    .where(eq(strengthSessions.id, sessionId))
    .limit(1);
  if (!row || row.profileId !== null) return;

  if (!row.garminWorkoutId) {
    if (!row.watchEligible) return;
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

/**
 * Make Garmin match the plan again, additively.
 *
 * Anything Kadenz believes it pushed but that is no longer on Garmin gets its
 * stored id cleared, so the normal window push re-creates it — this is how a
 * plan repairs itself after workouts are removed on Garmin's side. Nothing is
 * ever deleted here; repair only ever adds.
 */
export async function resyncGarminWindow(): Promise<{
  repushed: number;
  runsQueued: number;
  strengthQueued: number;
}> {
  const empty = { repushed: 0, runsQueued: 0, strengthQueued: 0 };
  if (!garminClient.isConfigured()) return empty;
  if (!(await isGarminWorkoutSyncEnabled())) return empty;

  const onGarmin = await garminClient.listWorkouts(300);
  const idsOnGarmin = new Set(onGarmin.map((w) => w.garminWorkoutId));

  const [runRows, strengthRows] = await Promise.all([
    db
      .select({ id: workouts.id, garminWorkoutId: workouts.garminWorkoutId })
      .from(workouts)
      .where(isNotNull(workouts.garminWorkoutId)),
    db
      .select({ id: strengthSessions.id, garminWorkoutId: strengthSessions.garminWorkoutId })
      .from(strengthSessions)
      .where(isNotNull(strengthSessions.garminWorkoutId)),
  ]);

  const staleRuns = rowsNeedingRepush(runRows, idsOnGarmin);
  const staleStrength = rowsNeedingRepush(strengthRows, idsOnGarmin);

  if (staleRuns.length > 0) {
    await db
      .update(workouts)
      .set({ garminWorkoutId: null })
      .where(inArray(workouts.id, staleRuns));
  }
  if (staleStrength.length > 0) {
    await db
      .update(strengthSessions)
      .set({ garminWorkoutId: null })
      .where(inArray(strengthSessions.id, staleStrength));
  }

  // Cleared ids look "never pushed", so the window sync re-creates them.
  const runsQueued = await queueGarminWindowSync();
  const strengthQueued = await queueGarminStrengthWindowSync();

  return {
    repushed: staleRuns.length + staleStrength.length,
    runsQueued,
    strengthQueued,
  };
}

export async function processGarminOutbox(): Promise<SyncResult> {
  await resetStaleClaims("garmin");

  const result: SyncResult = { processed: 0, succeeded: 0, failed: 0, errors: [] };

  // Atomic claim (see claimJobs in sync-manager.ts) — safe against two
  // drains running at once, and orders deletes ahead of creates so a stale
  // watch entry from a replaced plan clears before the new plan's workouts
  // compete for outbox slots.
  const jobs = await claimJobs("garmin");

  // List Garmin at most once per drain, and only when this batch actually
  // has something to create — an update/delete-only drain (the common case)
  // pays nothing extra. See buildAdoptionContext / findAdoptionCandidate for
  // why this exists: it closes the partial-failure duplicate window in
  // PLAN_OF_ATTACK.md §4.
  const hasCreateJob = jobs.some((j) => j.action === "create");
  const adoption = hasCreateJob ? await buildAdoptionContext() : null;

  for (const job of jobs) {
    result.processed++;

    try {
      await processGarminJob(job, adoption);
      await db
        .update(syncOutbox)
        .set({ status: "completed", processedAt: new Date() })
        .where(eq(syncOutbox.id, job.id));
      result.succeeded++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // claimJobs already incremented attempts as part of the atomic claim.
      const newAttempts = job.attempts;
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

async function processGarminJob(
  job: typeof syncOutbox.$inferSelect,
  adoption: AdoptionContext | null
): Promise<void> {
  if (job.entityType === "strength_session") {
    await processGarminStrengthJob(job, adoption);
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
    with: {
      blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
      week: { columns: { weekNumber: true } },
      plan: { columns: { name: true, planLengthWeeks: true } },
    },
  });
  if (!row) throw new Error(`Workout ${workoutId} not found`);
  // Rest days and already-completed workouts never go to the watch.
  if (row.type === "rest") return;

  const scheduledDate = toGarminDate(row.date);

  const input = {
    // "W3 · Easy Run 10km" — week-prefixed so the watch list is unambiguous.
    title: garminLabel(row.title, { weekNumber: row.week?.weekNumber ?? null }),
    // Plan/week overview: "Plan Name (Week 3/8)" then the workout's notes.
    description: garminDescription({
      planName: row.plan?.name,
      weekNumber: row.week?.weekNumber ?? null,
      totalWeeks: row.plan?.planLengthWeeks ?? null,
      body: row.description,
    }),
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
  };

  if (row.garminWorkoutId) {
    // Already on the watch — edit it in place so a changed distance or pace
    // actually reaches the device, and keep its calendar day correct.
    await garminClient.updateWorkout(row.garminWorkoutId, input);
    return;
  }

  if (row.status !== "planned") return;

  // Adopt-before-create: if the exact workout we're about to send already
  // exists on Garmin under our tag and isn't claimed by another row, it's
  // almost certainly a leftover from an earlier create whose id write never
  // landed (PLAN_OF_ATTACK.md §4) — reuse its id instead of pushing a
  // duplicate. A miss just falls through to create, same as before this
  // existed. See garmin-adoption.ts for why resolving through it (rather
  // than creating directly) also protects against two create jobs in the
  // same drain adopting the same remote workout.
  const garminWorkoutId = await resolveGarminWorkoutId(
    adoption,
    input.title,
    scheduledDate,
    () => garminClient.createWorkout(input)
  );

  await writeBackGarminId(
    async () => {
      await db.update(workouts).set({ garminWorkoutId }).where(eq(workouts.id, workoutId));
    },
    garminWorkoutId,
    `kadenz workout ${workoutId}`
  );
}


// ── Strength sessions ────────────────────────────────────────────────────────

async function processGarminStrengthJob(
  job: typeof syncOutbox.$inferSelect,
  adoption: AdoptionContext | null
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

  if (row.status !== "planned" && !row.garminWorkoutId) return;

  const type = row.type as StrengthSessionType;
  // A custom-workout session (title differs from the stock template's
  // title) already has its own real content and duration — don't re-fit it
  // against the stock template.
  const isCustom = row.title !== SESSION_TEMPLATES[type].title;

  // The plan is derived, not stored: build it the same way the app does so
  // the watch shows the loads the athlete is actually meant to lift today —
  // reshaped to the chosen session length so a 30-min day doesn't push a
  // 50-min plan to the wrist.
  // Fit to the athlete's Kraft length SETTING, not the stored estimate — see
  // the sessions/[id] route: feeding targetDurationMinutes back as the fit
  // target shrinks the session on each pass.
  // Fetched once and handed to buildPlannedSession below, same as the
  // sessions/[id] route — avoids a second strength_plan_settings query.
  const settingsRow = await getStrengthPlanSettingsRow(row.profileId);
  const fitMinutes = isCustom ? undefined : planDurationMinutesFromRow(settingsRow);
  const { exercises: planned, estimatedDurationMinutes } = await buildPlannedSession(
    type,
    row.date,
    row.profileId,
    fitMinutes,
    [],
    settingsRow
  );
  if (!isCustom && row.targetDurationMinutes !== estimatedDurationMinutes) {
    await db
      .update(strengthSessions)
      .set({ targetDurationMinutes: estimatedDurationMinutes })
      .where(eq(strengthSessions.id, sessionId));
  }
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

  // Week-prefix + duration so the watch list reads like the plan:
  // "W3 · Upper · Kraft · 30 min". Week comes from the active running plan the
  // strength schedule follows; standalone blocks (no plan) just omit it.
  const [activePlan] = await db
    .select({
      name: plans.name,
      startDate: plans.startDate,
      planLengthWeeks: plans.planLengthWeeks,
    })
    .from(plans)
    .where(eq(plans.status, "active"))
    .limit(1);
  const durationMin = isCustom
    ? row.targetDurationMinutes
    : estimatedDurationMinutes;
  const weekNumber = activePlan ? planWeekNumber(row.date, activePlan.startDate) : null;
  const workout = {
    sessionId: row.id,
    title: garminLabel(row.title, {
      weekNumber,
      metric: durationMin ? `${durationMin} min` : null,
    }),
    // Plan/week overview: "Plan Name (Week 3/8)" then a strength summary.
    description: garminDescription({
      planName: activePlan?.name,
      weekNumber,
      totalWeeks: activePlan?.planLengthWeeks ?? null,
      body: `Strength · ${exercises.length} exercises${durationMin ? ` · ~${durationMin} min` : ""}`,
    }),
    date: row.date,
    exercises,
  };

  if (row.garminWorkoutId) {
    // Loads change as the athlete progresses — edit the existing workout so
    // the watch shows today's prescription, not last month's.
    await garminClient.updateStrengthWorkout(row.garminWorkoutId, workout);
    return;
  }

  // Same adopt-before-create rule as the run push (see there for why) — a
  // matching strength workout already on Garmin under our tag and unclaimed
  // is a leftover id write that never landed, not a workout to duplicate.
  const garminWorkoutId = await resolveGarminWorkoutId(
    adoption,
    workout.title,
    scheduledDate,
    () => garminClient.pushStrengthWorkout(workout)
  );

  await writeBackGarminId(
    async () => {
      await db
        .update(strengthSessions)
        .set({ garminWorkoutId })
        .where(eq(strengthSessions.id, sessionId));
    },
    garminWorkoutId,
    `kadenz strength session ${sessionId}`
  );
}
