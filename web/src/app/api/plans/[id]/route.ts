import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, plans, weeks, workouts, blocks } from "@/db";
import { generatePlan } from "@/lib/plan-engine/plan-generator";
import type { PlanConfig } from "@/lib/plan-engine/types";
import { getCurrentFitnessEstimate } from "@/lib/current-fitness";
import { queuePlanWorkoutsSync, queueWorkoutEventDeletes } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWindowSync, queueGarminWorkoutDeletes } from "@/lib/sync/garmin-sync";
import { isGarminWorkoutSyncEnabled } from "@/lib/sync/garmin-config";
import { garminClient } from "@/lib/sync/garmin-client";
import { reconcileStrengthSchedule } from "@/lib/strength/schedule";

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
// generated weeks/workouts/blocks. Note: completed activities keep their data
// (their workout link becomes null via ON DELETE SET NULL), and any stale
// calendar events from the previous schedule are not pruned here.

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

    // Capture the old workouts' calendar events before we drop them, so their
    // now-stale events can be pruned from Google Calendar.
    const oldWorkouts = await db
      .select({
        workoutId: workouts.id,
        gcalEventId: workouts.gcalEventId,
        garminWorkoutId: workouts.garminWorkoutId,
      })
      .from(workouts)
      .where(eq(workouts.planId, id));
    const staleEvents = oldWorkouts
      .filter((w) => !!w.gcalEventId)
      .map((w) => ({ workoutId: w.workoutId, gcalEventId: w.gcalEventId! }));
    const staleGarmin = oldWorkouts
      .filter((w) => !!w.garminWorkoutId)
      .map((w) => ({ workoutId: w.workoutId, garminWorkoutId: w.garminWorkoutId! }));

    // Replace the schedule: delete existing weeks (cascades workouts + blocks).
    await db.delete(weeks).where(eq(weeks.planId, id));

    const weekValues = generated.weeks.map((week) => ({
      planId: id,
      weekNumber: week.weekNumber,
      phase: week.phase,
      type: week.type,
      targetKm: week.targetKm,
    }));
    const insertedWeeks = await db.insert(weeks).values(weekValues).returning();
    const weekIdMap = new Map<number, string>();
    for (const w of insertedWeeks) weekIdMap.set(w.weekNumber, w.id);

    const workoutValues = generated.weeks.flatMap((week) =>
      week.workouts.map((workout) => ({
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
    const insertedWorkouts = await db.insert(workouts).values(workoutValues).returning();

    const workoutIdMap = new Map<string, string>();
    for (const wo of insertedWorkouts) {
      workoutIdMap.set(`${wo.weekId}:${wo.sortOrder}`, wo.id);
    }

    const blockValues = generated.weeks.flatMap((week) =>
      week.workouts.flatMap((workout) =>
        workout.blocks.map((block) => ({
          workoutId: workoutIdMap.get(`${weekIdMap.get(week.weekNumber)!}:${workout.sortOrder}`)!,
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

    isConnected()
      .then((connected) => {
        if (connected) {
          // Prune the old schedule's events, then create the new ones.
          queueWorkoutEventDeletes(staleEvents).catch((err) =>
            console.error("Failed to queue gcal event deletes:", err)
          );
          queuePlanWorkoutsSync(id, "gcal").catch((err) =>
            console.error("Failed to queue gcal sync:", err)
          );
        }
      })
      .catch(() => {});

    // Garmin: prune old pushed workouts (whenever the worker is deployed —
    // they'd otherwise go stale), then push the new 14-day window if enabled.
    if (garminClient.isConfigured()) {
      queueGarminWorkoutDeletes(staleGarmin).catch((err) =>
        console.error("Failed to queue Garmin workout deletes:", err)
      );
      isGarminWorkoutSyncEnabled()
        .then((enabled) => {
          if (enabled) {
            queueGarminWindowSync(id).catch((err) =>
              console.error("Failed to queue Garmin sync:", err)
            );
          }
        })
        .catch(() => {});
    }

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

    // Remove any workouts this plan pushed to the watch (fire-and-forget).
    if (garminClient.isConfigured()) {
      db.select({ workoutId: workouts.id, garminWorkoutId: workouts.garminWorkoutId })
        .from(workouts)
        .where(eq(workouts.planId, id))
        .then((rows) =>
          queueGarminWorkoutDeletes(
            rows
              .filter((w) => !!w.garminWorkoutId)
              .map((w) => ({ workoutId: w.workoutId, garminWorkoutId: w.garminWorkoutId! }))
          )
        )
        .catch((err) => console.error("Failed to queue Garmin workout deletes:", err));
    }

    return Response.json({ id: updated.id, status: "archived" });
  } catch (err) {
    console.error("DB error archiving plan:", err);
    return Response.json({ error: "Failed to archive plan" }, { status: 500 });
  }
}
