import { NextRequest, after } from "next/server";
import { and, eq, isNull, not, notInArray } from "drizzle-orm";
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
import { queueRetireDeletes, retirePlanSyncArtifacts, deleteFuturePlanWorkouts } from "@/lib/sync/plan-retire";
import { drainOutboxNow } from "@/lib/sync/outbox-drain";
import { currentUserId, withUser } from "@/db/with-user";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";
import { getPlanById } from "../service";

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
// ?summary=1 drops every workout's blocks (warmup/work/cooldown/rep detail) —
// the bulk of the payload (~101KB full vs ~a few KB summary). Stats only ever
// reads week.targetKm and workout.date/type/status for its distribution maths,
// never block detail, so it asks for the summary. Today's week sheet and
// plan/rearrange genuinely need every block and still get the full shape.

export const GET = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const summary = request.nextUrl.searchParams.get("summary") === "1";

  // Confirms both existence and ownership before the relational fetch below —
  // RLS would filter an unowned plan to nothing either way, but this makes
  // the intent explicit and gives an honest 404 instead of relying on the
  // shape of a relational query returning empty.
  await requireOwned(plans, id);

  try {
    const plan = await getPlanById(id, { summary });

    if (!plan) {
      return Response.json({ error: "Plan not found" }, { status: 404 });
    }

    return Response.json(plan);
  } catch (err) {
    console.error("DB error fetching plan:", err);
    return Response.json({ error: "Failed to fetch plan" }, { status: 500 });
  }
});

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

export const PUT = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Checked before the body is even parsed — a plan PUT for a resource the
  // caller does not own must 404 regardless of whether the body is valid.
  await requireOwned(plans, id);

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
    // Ownership was already confirmed above (requireOwned). ownedBy is kept
    // in this WHERE too, matching every other UPDATE in this handler — the
    // filter is the intent at the call site, RLS is the guarantee.
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
      .where(and(eq(plans.id, id), ownedBy(plans)));

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
          ownedBy(workouts),
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
        userId: workouts.userId,
      })
      .from(workouts)
      .where(and(eq(workouts.planId, id), ownedBy(workouts), untouchedPlanned));

    // Replace the schedule, but only the part of it the athlete never
    // touched: delete untouched planned workouts (cascades their blocks),
    // leaving completed/skipped/missed workouts and any hand-edited or
    // timed workout (still "planned", but adopted by the athlete) alone.
    await db
      .delete(workouts)
      .where(and(eq(workouts.planId, id), ownedBy(workouts), untouchedPlanned));

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
            ownedBy(weeks),
            notInArray(weeks.weekNumber, [...merge.retainedWeekNumbers])
          )
        );
    } else {
      await db.delete(weeks).where(and(eq(weeks.planId, id), ownedBy(weeks)));
    }

    // Map every week number the new schedule needs to a week id: retained
    // weeks already have one (they survived the delete above), the rest get
    // a fresh row.
    const weekIdMap = new Map<number, string>();
    if (merge.retainedWeekNumbers.size > 0) {
      const retainedWeeks = await db
        .select({ id: weeks.id, weekNumber: weeks.weekNumber })
        .from(weeks)
        .where(and(eq(weeks.planId, id), ownedBy(weeks)));
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
        userId: currentUserId(),
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
          userId: currentUserId(),
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
            userId: currentUserId(),
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
    //
    // ownerId is captured before after() is registered, and re-entered with
    // withUser inside the callback: the response has already been sent by
    // the time after() runs, which means both the AsyncLocalStorage context
    // withSession entered AND the transaction it opened are gone (the
    // transaction commits when the handler returns), so the callback opens
    // its own fresh context rather than trying to inherit one that no
    // longer exists.
    const insertedWorkoutIds = insertedWorkouts.map((wo) => wo.id);
    const ownerId = currentUserId();
    after(async () => {
      await withUser(ownerId, async () => {
        try {
          if (await isConnected(ownerId)) {
            // Only push the freshly inserted workouts — a preserved workout
            // already has (or never had) its own event and must not be
            // re-queued as a "create", which would push a duplicate event and
            // overwrite the id of the one already on the calendar.
            await queuePlanWorkoutsSync(id, ownerId, "gcal", insertedWorkoutIds);
          }
        } catch (err) {
          console.error("Failed to queue gcal sync:", err);
        }
        try {
          if (garminClient.isConfigured() && (await isGarminWorkoutSyncEnabled(ownerId))) {
            await queueGarminWindowSync(ownerId, id);
          }
        } catch (err) {
          console.error("Failed to queue Garmin sync:", err);
        }
        // Runs after the queueing above so the rows it just wrote are included.
        await drainOutboxNow(ownerId);
      });
    });

    // Rebuild the auto strength schedule around the regenerated run days.
    // Strength sessions have no plan FK — without this, the old schedule's
    // future auto-scheduled sessions linger and the top-up stacks new ones.
    try {
      await reconcileStrengthSchedule(null, currentUserId());
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
});

// ── DELETE /api/plans/[id] — soft-delete (archived) ──────────────────────────

export const DELETE = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  try {
    // ownedBy(plans) in the WHERE, not a separate lookup: an unowned id
    // simply matches nothing and updated stays empty, which the check below
    // already turns into the honest 404.
    const [updated] = await db
      .update(plans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(and(eq(plans.id, id), ownedBy(plans)))
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

    // Then drop the upcoming rows themselves. Strictly after the line above,
    // which reads them to queue the calendar and watch deletes. Cancelling
    // used to archive the plan and leave every workout in the database.
    const { deleted } = await deleteFuturePlanWorkouts(id).catch((err: unknown) => {
      console.error("Failed to delete cancelled plan's future workouts:", err);
      return { deleted: 0 };
    });

    // Flush those deletes promptly instead of waiting for the daily cron —
    // this is what actually clears the archived plan's workouts off the
    // watch and calendar (see outbox-drain.ts). Not scheduleOutboxDrain():
    // that helper's after() callback has no RLS context of its own to
    // re-enter, so it would run drainOutboxNow(currentUserId()) (and the currentUserId()
    // calls inside sync-manager.ts it reaches) after this handler's
    // transaction has already committed and its context is gone. Capture
    // the owner now, while the context is live, and re-enter it explicitly.
    const ownerId = currentUserId();
    after(async () => {
      await withUser(ownerId, () => drainOutboxNow(ownerId));
    });

    return Response.json({ id: updated.id, status: "archived", workoutsDeleted: deleted });
  } catch (err) {
    console.error("DB error archiving plan:", err);
    return Response.json({ error: "Failed to archive plan" }, { status: 500 });
  }
});
