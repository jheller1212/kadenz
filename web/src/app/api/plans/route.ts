import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { isNull } from "drizzle-orm";
import { db, plans, weeks, workouts, blocks, strengthPlanSettings } from "@/db";
import { generatePlanForConfig } from "@/lib/plan-engine/plan-generator";
import type { PlanConfig } from "@/lib/plan-engine/types";
import { getCurrentFitnessEstimate } from "@/lib/current-fitness";
import { queuePlanWorkoutsSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { queueGarminWindowSync } from "@/lib/sync/garmin-sync";
import { isGarminWorkoutSyncEnabled } from "@/lib/sync/garmin-config";
import { retirePlanSyncArtifacts } from "@/lib/sync/plan-retire";
import { pruneAutoSchedule, reconcileStrengthSchedule } from "@/lib/strength/schedule";
import { timer } from "@/lib/timing";

// ── Zod schema ────────────────────────────────────────────────────────────────

const PlanConfigSchema = z.object({
  // "race" is the default so existing clients keep working unchanged.
  intent: z.enum(["race", "get_fit", "maintain", "return"]).default("race"),
  // Optional for non-race intents (defaults to the 10k reference then).
  raceDistance: z.enum(["5k", "10k", "half", "marathon", "ultra", "custom"]).optional(),
  customDistanceKm: z.number().positive().max(500).optional(),
  // Required for race; synthesized for non-race.
  goalTimeSeconds: z.number().int().positive().optional(),
  startDate: z.string().datetime(),
  // Race intent needs a race date; non-race intents use planLengthWeeks instead.
  raceDate: z.string().datetime().optional(),
  planLengthWeeks: z.number().int().min(4).max(26).optional(),
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
  // What to do with an existing active strength plan. Absent = adapt, which is
  // the long-standing behaviour and what athletes without a strength plan get.
  strengthMode: z.enum(["adapt", "keep", "new"]).default("adapt"),
});

// ── POST /api/plans ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
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
  const isRace = data.intent === "race";

  // Per-intent required fields.
  if (isRace && (data.goalTimeSeconds == null || !data.raceDate)) {
    return Response.json(
      { error: "Race plans require goalTimeSeconds and raceDate" },
      { status: 422 }
    );
  }
  if (isRace && data.raceDistance === "custom" && !data.customDistanceKm) {
    return Response.json(
      { error: "A custom race plan requires customDistanceKm" },
      { status: 422 }
    );
  }
  if (!isRace && data.planLengthWeeks == null) {
    return Response.json(
      { error: "Non-race plans require planLengthWeeks" },
      { status: 422 }
    );
  }

  // Read current fitness before generating, so paces are grounded in what the
  // athlete can actually run today — a null estimate (no synced history yet)
  // falls back to the pre-existing goal/level-only behaviour untouched.
  let currentFitnessVdot: number | null = null;
  try {
    const estimate = await getCurrentFitnessEstimate();
    currentFitnessVdot = estimate?.vdot ?? null;
  } catch (err) {
    console.error("Failed to read current fitness estimate:", err);
  }

  const config: PlanConfig = {
    ...data,
    // Non-race plans use a neutral reference distance; the generator overrides it.
    raceDistance: data.raceDistance ?? "10k",
    // Synthesized for non-race by the generator; 0 here just satisfies the type.
    goalTimeSeconds: data.goalTimeSeconds ?? 0,
    startDate: new Date(data.startDate),
    raceDate: data.raceDate ? new Date(data.raceDate) : undefined,
    currentFitnessVdot,
  };

  // Validate date ordering (race intent only — non-race derives its own end).
  if (isRace && config.raceDate && config.raceDate <= config.startDate) {
    return Response.json(
      { error: "raceDate must be after startDate" },
      { status: 422 }
    );
  }

  const t = timer("plans.create");
  let generatedPlan;
  try {
    generatedPlan = generatePlanForConfig(config);
    t.mark("generate");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan generation failed";
    return Response.json({ error: message }, { status: 422 });
  }

  try {
    // Archive all existing active plans
    const archivedPlans = await db
      .update(plans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(plans.status, "active"))
      .returning({ id: plans.id });
    t.mark("archiveActive");

    // Prune the archived plan(s)' pushed workouts from both the calendar and
    // the watch — this is the main cause of the duplicate-workout bug: an
    // archive with no cleanup left the old plan's events/watch entries in
    // place while the new plan pushed its own on top. Awaited so the queue
    // rows are durably written before the response returns (a frozen
    // invocation can no longer lose them); the actual network deletes still
    // flush in the background, same as before. Old and new workouts never
    // share an id, so this can't race the new plan's pushes into deleting
    // the wrong thing.
    for (const p of archivedPlans) {
      await retirePlanSyncArtifacts(p.id).catch((err) =>
        console.error("Failed to retire old plan's sync artifacts:", err)
      );
    }
    t.mark("retireOldPlan");

    // Insert plan
    const [insertedPlan] = await db
      .insert(plans)
      .values({
        name: generatedPlan.name,
        intent: generatedPlan.intent,
        raceDistance: generatedPlan.raceDistance,
        customDistanceKm: generatedPlan.customDistanceKm ?? null,
        goalTimeSeconds: generatedPlan.goalTimeSeconds,
        vdot: generatedPlan.vdot,
        startDate: generatedPlan.startDate,
        raceDate: generatedPlan.raceDate,
        planLengthWeeks: generatedPlan.planLengthWeeks,
        daysPerWeek: generatedPlan.daysPerWeek,
        preferredLongRunDay: generatedPlan.preferredLongRunDay,
        currentWeeklyKm: generatedPlan.currentWeeklyKm,
        trainingVolume: generatedPlan.trainingVolume,
        trainingDifficulty: generatedPlan.trainingDifficulty,
        longRunCapKm: generatedPlan.longRunCapKm,
        easyRunMinKm: generatedPlan.easyRunMinKm,
        hillyArea: generatedPlan.hillyArea,
        runnerLevel: generatedPlan.runnerLevel ?? null,
        availableDays: generatedPlan.availableDays ?? null,
        status: "active",
      })
      .returning();
    t.mark("insertPlan");

    const planId = insertedPlan.id;

    // Batch insert all weeks at once
    const weekValues = generatedPlan.weeks.map((week) => ({
      planId,
      weekNumber: week.weekNumber,
      phase: week.phase,
      type: week.type,
      targetKm: week.targetKm,
    }));
    const insertedWeeks = await db.insert(weeks).values(weekValues).returning();
    t.mark("insertWeeks");

    // Build a map of weekNumber → weekId
    const weekIdMap = new Map<number, string>();
    for (const w of insertedWeeks) {
      weekIdMap.set(w.weekNumber, w.id);
    }

    // Batch insert all workouts at once
    const workoutValues = generatedPlan.weeks.flatMap((week) =>
      week.workouts.map((workout) => ({
        weekId: weekIdMap.get(week.weekNumber)!,
        planId,
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
    t.mark("insertWorkouts");

    // Build a map of (weekId + sortOrder) → workoutId for block assignment
    const workoutIdMap = new Map<string, string>();
    for (const wo of insertedWorkouts) {
      workoutIdMap.set(`${wo.weekId}:${wo.sortOrder}`, wo.id);
    }

    // Batch insert all blocks at once
    const blockValues = generatedPlan.weeks.flatMap((week) =>
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
      t.mark("insertBlocks");
    }

    // Queue gcal sync if connected (fire-and-forget — don't fail plan creation if sync fails)
    isConnected().then((connected) => {
      if (connected) {
        queuePlanWorkoutsSync(planId, "gcal").catch((err) => {
          console.error("Failed to queue gcal sync:", err);
        });
      }
    }).catch(() => {});

    // Push the first 14 days of run workouts to the watch (fire-and-forget).
    isGarminWorkoutSyncEnabled()
      .then((enabled) => {
        if (enabled) {
          queueGarminWindowSync(planId).catch((err) =>
            console.error("Failed to queue Garmin sync:", err)
          );
        }
      })
      .catch(() => {});

    // Rebuild the auto strength schedule around the new plan's run days.
    // Strength sessions have no plan FK — without this, the old plan's future
    // auto-scheduled sessions linger and the top-up stacks new ones on top.
    // Reported back to the client so the plan-ready screen can tell the athlete
    // their strength plan survived and was re-fitted, rather than leaving them
    // to guess. Null when strength was never set up.
    let strength: {
      active: boolean;
      sessionsPerWeek: number;
      mode: "adapt" | "keep" | "new";
    } | null = null;
    // The reconcile itself is fire-and-forget: it prunes and re-creates strength
    // sessions across the whole plan, and awaiting it put all of that on the
    // critical path of the request the athlete is staring at a progress bar for.
    // Nothing in the response depends on its result — the reveal copy only needs
    // sessionsPerWeek — so the plan returns as soon as it exists.
    // "keep" leaves the existing schedule untouched; "new" leaves it alone here
    // because the athlete is about to replace it from strength setup. Only
    // "adapt" re-fits the sessions around the new run days.
    if (data.strengthMode === "adapt") {
      reconcileStrengthSchedule(null).catch((err) =>
        console.error("Failed to reconcile strength schedule:", err)
      );
    } else if (data.strengthMode === "new") {
      // The athlete is replacing the schedule from strength setup, so the old
      // auto-scheduled sessions must go — otherwise they linger against a plan
      // that no longer exists. Completed sessions are never touched.
      pruneAutoSchedule(null).catch((err) =>
        console.error("Failed to prune strength schedule:", err)
      );
    }
    try {
      const [settings] = await db
        .select()
        .from(strengthPlanSettings)
        .where(isNull(strengthPlanSettings.profileId));
      if (settings) {
        strength = {
          active: settings.active,
          sessionsPerWeek: settings.sessionsPerWeek,
          mode: data.strengthMode,
        };
      }
    } catch (err) {
      console.error("Failed to read strength settings:", err);
    }
    t.mark("strengthSettings");

    // Assembled from the rows we just inserted rather than read back. The
    // re-fetch pulled the whole tree (weeks -> workouts -> blocks) straight
    // after writing it, on the one connection this client allows, purely to
    // return data already in hand. Blocks are omitted: the only consumer is the
    // create flow, which reads the plan fields plus weeks[].workouts[].targetKm
    // for the reveal's peak-week figure.
    const workoutsByWeek = new Map<string, typeof insertedWorkouts>();
    for (const wo of insertedWorkouts) {
      const list = workoutsByWeek.get(wo.weekId);
      if (list) list.push(wo);
      else workoutsByWeek.set(wo.weekId, [wo]);
    }
    const fullPlan = {
      ...insertedPlan,
      weeks: [...insertedWeeks]
        .sort((a, b) => a.weekNumber - b.weekNumber)
        .map((w) => ({
          ...w,
          workouts: (workoutsByWeek.get(w.id) ?? []).sort(
            (a, b) => a.sortOrder - b.sortOrder
          ),
        })),
    };

    t.mark("assemblePlan");
    t.done({
      weeks: generatedPlan.weeks.length,
      workouts: workoutValues.length,
      blocks: blockValues.length,
    });

    // `strength` is additive — existing clients that only read plan fields are
    // unaffected.
    return Response.json({ ...fullPlan, strength }, { status: 201 });
  } catch (err) {
    console.error("DB error creating plan:", err);
    return Response.json({ error: "Failed to save plan" }, { status: 500 });
  }
}

// ── GET /api/plans ────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const rows = await db
      .select({
        id: plans.id,
        name: plans.name,
        status: plans.status,
        intent: plans.intent,
        raceDistance: plans.raceDistance,
        raceDate: plans.raceDate,
      })
      .from(plans);

    const now = new Date();
    // A race plan only ever leaves "active" via a logged result (see
    // /api/workouts/[id]/race-result) or an explicit archive — so still
    // "active" past race day means nobody logged what happened. Surfaced
    // here rather than resolved silently: the plan-lifecycle UI decides what
    // to do with it, this just makes sure it can't go unnoticed.
    const withLifecycle = rows.map((p) => ({
      ...p,
      pastRaceDayUnlogged:
        p.intent === "race" && p.status === "active" && p.raceDate < now,
    }));

    return Response.json(withLifecycle);
  } catch (err) {
    console.error("DB error listing plans:", err);
    return Response.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}
