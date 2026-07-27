import { NextRequest, after } from "next/server";
import { and, eq, isNotNull, isNull, ne, not, notInArray, or } from "drizzle-orm";
import { z } from "zod";
import { db, plans, weeks, workouts, blocks } from "@/db";
import { generatePlan } from "@/lib/plan-engine/plan-generator";
import type { PlanConfig } from "@/lib/plan-engine/types";
import { planRegenerateMerge } from "@/lib/plan-engine/regenerate-merge";
import { getCurrentFitnessEstimate } from "@/lib/current-fitness";
import { queuePlanWorkoutsSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWindowSync } from "@/lib/sync/garmin-sync";
import { isGarminWorkoutSyncEnabled } from "@/lib/sync/garmin-config";
import { garminClient } from "@/lib/sync/garmin-client";
import { reconcileStrengthSchedule } from "@/lib/strength/schedule";
import { queueRetireDeletes, retirePlanSyncArtifacts } from "@/lib/sync/plan-retire";
import { drainOutboxNow, scheduleOutboxDrain } from "@/lib/sync/outbox-drain";

const PlanConfigSchema = z.object({
  raceDistance: z.enum(["5k", "10k", "half", "marathon", "ultra", "custom"]),
  goalTimeSeconds: z.number().int().positive(),
  startDate: z.string().datetime(),
  raceDate: z.string().datetime(),
  daysPerWeek: z.number().int().min(2).max(6),
  trainingVolume: z.enum(["beginner", "low", "medium", "high", "elite"]),
  trainingDifficulty: z.enum(["easy", "moderate", "hard"]),
  preferredLongRunDay: z.number().int().min(0).max(6),
  hillyArea: z.boolean(),
  raceElevation: z.enum(["flat", "rolling", "hilly", "mountainous"]).default("flat"),
  currentWeeklyKm: z.number().nonnegative(),
  longRunCapKm: z.number().nonnegative(),
  easyRunMinKm: z.number().nonnegative().default(0),
  runnerLevel: z.enum(["beginner", "intermediate", "advanced", "elite"]).nullish(),
  availableDays: z.array(z.number().int().min(0).max(6)).min(2).max(7).nullish(),
});

// ── GET /api/plans/[id] ───────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const plan = await db.query.plans.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      with: {
        weeks: {
          orderBy: (w, { asc }) => [asc(w.weekNumber)],
          with: {
            workouts: {
              orderBy: (wo, { asc }) => [asc(wo.sortOrder)],
              with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
            },
          },
        },
      },
    });

    if (!plan) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    // See /api/plans (list) for why "still active past race day" implies
    // unlogged rather than needing a separate lookup.
    const pastRaceDayUnlogged =
      plan.intent === "race" && plan.status === "active" && plan.raceDate < new Date();

    return Response.json({ ...plan, pastRaceDayUnlogged });
  } catch (err) {
    console.error("DB error fetching plan:", err);
    return Response.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
}

// ── PUT /api/plans/[id] — regenerate the plan in place ───────────────────────
// Keeps the same plan id (stays the "current" plan) and swaps in freshly
// generated weeks/workouts/blocks — but only for workouts still "planned"
// AND untouched by the athlete. A completed, skipped or missed workout (and
// the week it's in) is exempt from deletion entirely: its status, actualKm,
// actualDurationSeconds, rpe and its link to any backing activities row all
// survive untouched. So is a still-"planned" workout the athlete hand-tuned
// (edited=true, a distance/pace override) or gave a specific start time
// (timeOfDay set) — same reasoning the strength side already applies via
// clearsAutoScheduled(): touching a field the scheduler doesn't own adopts
// the row and takes it out of the auto-managed pool, regardless of status.
// See regenerate-merge.ts for the full model and why.

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PlanConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  const data = parsed.data;

  let currentFitnessVdot: number | null = null;
  try {
    const estimate = await getCurrentFitnessEstimate();
    currentFitnessVdot = estimate?.vdot ?? null;
  } catch (err) {
    console.error("Failed to read current fitness estimate:", err);
  }

  const config: PlanConfig = {
    ...data,
    startDate: new Date(data.startDate),
    raceDate: new Date(data.raceDate),
    currentFitnessVdot,
  };
  if (config.raceDate && config.raceDate <= config.startDate) {
    return Response.json({ error: "raceDate must be after startDate" }, { status: 422 });
  }

  let generated;
  try {
    generated = generatePlan(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan generation failed";
    return Response.json({ error: message }, { status: 422 });
  }

  try {
    const existing = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, id));
    if (existing.length === 0) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    // Update plan-level fields, keep it active.
    await db
      .update(plans)
      .set({
        name: generated.name,
        raceDistance: generated.raceDistance,
        goalTimeSeconds: generated.goalTimeSeconds,
        vdot: generated.vdot,
        startDate: generated.startDate,
        raceDate: generated.raceDate,
        planLengthWeeks: generated.planLengthWeeks,
        daysPerWeek: generated.daysPerWeek,
        preferredLongRunDay: generated.preferredLongRunDay,
        currentWeeklyKm: generated.currentWeeklyKm,
        trainingVolume: generated.trainingVolume,
        trainingDifficulty: generated.trainingDifficulty,
        longRunCapKm: generated.longRunCapKm,
        easyRunMinKm: generated.easyRunMinKm,
        hillyArea: generated.hillyArea,
        runnerLevel: generated.runnerLevel ?? null,
        availableDays: generated.availableDays ?? null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(plans.id, id));

    // A completed/skipped/missed workout is real history, and a still-planned
    // workout the athlete hand-tuned (edited=true) or gave a start time
    // (timeOfDay set) is a deliberate override — a plan edit must never
    // destroy either (see regenerate-merge.ts). Find those rows first — they
    // and the week they live in are exempt from everything below. Mirrors
    // isPreservedWorkout() in regenerate-merge.ts (kept as SQL here for
    // efficiency instead of fetching every workout to filter in JS).
    const untouchedPlanned = and(
      eq(workouts.status, "planned"),
      eq(workouts.edited, false),
      isNull(workouts.timeOfDay)
    );
    const preservedWorkouts = await db
      .select({
        id: workouts.id,
        weekId: workouts.weekId,
        weekNumber: weeks.weekNumber,
        date: workouts.date,
      })
      .from(workouts)
      .innerJoin(weeks, eq(workouts.weekId, weeks.id))
      .where(
        and(
          eq(workouts.planId, id),
          // Derived from untouchedPlanned rather than restated, so the two can
          // never drift apart. Spelling the inverse out by hand meant a future
          // change to what counts as "touched" could update one and not the
          // other, and a workout preserved by one predicate but deleted by the
          // other loses its calendar event or gains a duplicate.
          not(untouchedPlanned!)
        )
      );

    // Capture the old, about-to-be-deleted workouts' sync ids before we drop
    // them, so their now-stale calendar events and watch entries can be
    // pruned from both surfaces. Preserved workouts (history, or a hand
    // edit/time the athlete set) are excluded on purpose: their rows (and
    // thus their gcalEventId/garminWorkoutId) are never deleted, so their
    // events must never be queued for deletion either.
    const oldPlannedWorkouts = await db
      .select({
        id: workouts.id,
        gcalEventId: workouts.gcalEventId,
        garminWorkoutId: workouts.garminWorkoutId,
      })
      .from(workouts)
      .where(and(eq(workouts.planId, id), untouchedPlanned));

    // Replace the schedule, but only the part of it the athlete never
    // touched: delete untouched planned workouts (cascades their blocks),
    // leaving completed/skipped/missed workouts and any hand-edited or
    // timed workout (still "planned", but adopted by the athlete) alone.
    await db.delete(workouts).where(and(eq(workouts.planId, id), untouchedPlanned));

    // A week is only deleted once every workout it had was "planned" (i.e.
    // it's now empty). A week holding preserved history is kept in place —
    // deleting it would cascade the preserved workout away with it.
    const merge = planRegenerateMerge(
      preservedWorkouts,
      generated.weeks.map((week) => week.weekNumber)
    );

    if (merge.retainedWeekNumbers.size > 0) {
      await db
        .delete(weeks)
        .where(
          and(
            eq(weeks.planId, id),
            notInArray(weeks.weekNumber, [...merge.retainedWeekNumbers])
          )
        );
    } else {
      await db.delete(weeks).where(eq(weeks.planId, id));
    }

    // Map every week number the new schedule needs to a week id: retained
    // weeks already have one (they survived the delete above), the rest get
    // a fresh row.
    const weekIdMap = new Map<number, string>();
    if (merge.retainedWeekNumbers.size > 0) {
      const retainedWeeks = await db
        .select({ id: weeks.id, weekNumber: weeks.weekNumber })
        .from(weeks)
        .where(eq(weeks.planId, id));
      for (const w of retainedWeeks) weekIdMap.set(w.weekNumber, w.id);
    }

    const weekValues = generated.weeks
      .filter((week) => merge.weekNumbersToInsert.includes(week.weekNumber))
      .map((week) => ({
        planId: id,
        weekNumber: week.weekNumber,
        phase: week.phase,
        type: week.type,
        targetKm: week.targetKm,
      }));
    if (weekValues.length > 0) {
      const insertedWeeks = await db.insert(weeks).values(weekValues).returning();
      for (const w of insertedWeeks) weekIdMap.set(w.weekNumber, w.id);
    }

    // Drop any generated workout that would land on the same calendar date
    // as a preserved one — the athlete already has a real workout that day,
    // a freshly planned one must not double-book it.
    const workoutValues = generated.weeks.flatMap((week) =>
      week.workouts
        .filter((workout) =>
          merge.keepGeneratedWorkout({ weekNumber: week.weekNumber, date: workout.date })
        )
        .map((workout) => ({
          weekId: weekIdMap.get(week.weekNumber)!,
          planId: id,
          dayOfWeek: workout.dayOfWeek,
          date: workout.date,
          type: workout.type,
          title: workout.title,
          description: workout.description ?? null,
          targetKm: workout.targetKm ?? null,
          targetDurationMinutes: workout.targetDurationMinutes ?? null,
          sortOrder: workout.sortOrder,
        }))
    );
    const insertedWorkouts =
      workoutValues.length > 0 ? await db.insert(workouts).values(workoutValues).returning() : [];

    const workoutIdMap = new Map<string, string>();
    for (const wo of insertedWorkouts) {
      workoutIdMap.set(`${wo.weekId}:${wo.sortOrder}`, wo.id);
    }

    const blockValues = generated.weeks.flatMap((week) =>
      week.workouts
        .filter((workout) =>
          merge.keepGeneratedWorkout({ weekNumber: week.weekNumber, date: workout.date })
        )
        .flatMap((workout) =>
          workout.blocks.map((block) => ({
            workoutId: workoutIdMap.get(
              `${weekIdMap.get(week.weekNumber)!}:${workout.sortOrder}`
            )!,
            sortOrder: block.sortOrder,
            type: block.type,
            durationMinutes: block.durationMinutes ?? null,
            distanceKm: block.distanceKm ?? null,
            targetPaceSecKm: block.targetPaceSecKm ?? null,
            minPaceSecKm: block.minPaceSecKm ?? null,
            maxPaceSecKm: block.maxPaceSecKm ?? null,
            reps: block.reps ?? null,
            repDistanceKm: block.repDistanceKm ?? null,
            repRestSeconds: block.repRestSeconds ?? null,
          }))
        )
    );
    if (blockValues.length > 0) {
      await db.insert(blocks).values(blockValues);
    }

    // Prune the old, now-deleted planned workouts' events/watch entries on
    // both surfaces, then push the new ones. Awaited so the delete queue
    // rows are durably written before the response returns — a frozen
    // invocation used to be able to lose this outright (fire-and-forget, no
    // `await`). Old and new workouts are different rows with different ids,
    // so this can never race the new plan's pushes into deleting them.
    // Preserved workouts are deliberately excluded — their rows and ids
    // never changed, so their calendar/watch events must stay put.
    await queueRetireDeletes(oldPlannedWorkouts).catch((err) =>
      console.error("Failed to queue old schedule's sync deletes:", err)
    );

    // Queue gcal + Garmin sync for the regenerated plan, then drain both
    // outboxes — registered with after() so the work survives the response
    // being sent instead of riding a bare unawaited promise a frozen
    // invocation can drop outright (see outbox-drain.ts). The old schedule's
    // deletes were already awaited above via queueRetireDeletes, so this
    // drain flushes them first (deletes are prioritised — see claimJobs)
    // before pushing anything from the new schedule.
    const insertedWorkoutIds = insertedWorkouts.map((wo) => wo.id);
    after(async () => {
      try {
        if (await isConnected()) {
          // Only push the freshly inserted workouts — a preserved workout
          // already has (or never had) its own event and must not be
          // re-queued as a "create", which would push a duplicate event and
          // overwrite the id of the one already on the calendar.
          await queuePlanWorkoutsSync(id, "gcal", insertedWorkoutIds);
        }
      } catch (err) {
        console.error("Failed to queue gcal sync:", err);
      }
      try {
        if (garminClient.isConfigured() && (await isGarminWorkoutSyncEnabled())) {
          await queueGarminWindowSync(id);
        }
      } catch (err) {
        console.error("Failed to queue Garmin sync:", err);
      }
      // Runs after the queueing above so the rows it just wrote are included.
      await drainOutboxNow();
    });

    // Rebuild the auto strength schedule around the regenerated run days.
    // Strength sessions have no plan FK — without this, the old schedule's
    // future auto-scheduled sessions linger and the top-up stacks new ones.
    try {
      await reconcileStrengthSchedule(null);
    } catch (err) {
      console.error("Failed to reconcile strength schedule:", err);
    }

    const fullPlan = await db.query.plans.findFirst({
      where: (p, { eq }) => eq(p.id, id),
      with: {
        weeks: {
          orderBy: (w, { asc }) => [asc(w.weekNumber)],
          with: {
            workouts: {
              orderBy: (wo, { asc }) => [asc(wo.sortOrder)],
              with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
            },
          },
        },
      },
    });

    return Response.json(fullPlan);
  } catch (err) {
    console.error("DB error updating plan:", err);
    return Response.json({ error: "Failed to update plan" }, { status: 500 });
  }
}

// ── DELETE /api/plans/[id] — soft-delete (archived) ──────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [updated] = await db
      .update(plans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning({ id: plans.id });

    if (!updated) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    // Remove this plan's workouts from both the calendar and the watch.
    // Awaited so the delete queue rows are durably written before the
    // response returns instead of riding an unawaited promise a frozen
    // invocation could drop (this used to only cover Garmin, never gcal).
    await retirePlanSyncArtifacts(id).catch((err) =>
      console.error("Failed to retire plan's sync artifacts:", err)
    );

    // Flush those deletes promptly instead of waiting for the daily cron —
    // this is what actually clears the archived plan's workouts off the
    // watch and calendar (see outbox-drain.ts).
    scheduleOutboxDrain();

    return Response.json({ id: updated.id, status: "archived" });
  } catch (err) {
    console.error("DB error archiving plan:", err);
    return Response.json({ error: "Failed to archive plan" }, { status: 500 });
  }
}
