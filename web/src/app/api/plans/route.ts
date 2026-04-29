import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, plans, weeks, workouts, blocks } from "@/db";
import { generatePlan } from "@/lib/plan-engine/plan-generator";
import type { PlanConfig } from "@/lib/plan-engine/types";
import { queuePlanWorkoutsSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";

// ── Zod schema ────────────────────────────────────────────────────────────────

const PlanConfigSchema = z.object({
  raceDistance: z.enum(["5k", "10k", "half", "marathon"]),
  goalTimeSeconds: z.number().int().positive(),
  startDate: z.string().datetime(),
  raceDate: z.string().datetime(),
  daysPerWeek: z.number().int().min(3).max(6),
  trainingVolume: z.enum(["beginner", "low", "medium", "high", "elite"]),
  trainingDifficulty: z.enum(["easy", "moderate", "hard"]),
  preferredLongRunDay: z.number().int().min(0).max(6),
  hillyArea: z.boolean(),
  raceElevation: z.enum(["flat", "rolling", "hilly", "mountainous"]).default("flat"),
  currentWeeklyKm: z.number().nonnegative(),
  longRunCapKm: z.number().nonnegative(),
  easyRunMinKm: z.number().nonnegative().default(0),
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
  const config: PlanConfig = {
    ...data,
    startDate: new Date(data.startDate),
    raceDate: new Date(data.raceDate),
  };

  // Validate date ordering
  if (config.raceDate <= config.startDate) {
    return Response.json(
      { error: "raceDate must be after startDate" },
      { status: 422 }
    );
  }

  let generatedPlan;
  try {
    generatedPlan = generatePlan(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Plan generation failed";
    return Response.json({ error: message }, { status: 422 });
  }

  try {
    // Archive all existing active plans
    await db
      .update(plans)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(plans.status, "active"));

    // Insert plan
    const [insertedPlan] = await db
      .insert(plans)
      .values({
        name: generatedPlan.name,
        raceDistance: generatedPlan.raceDistance,
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
        hillyArea: generatedPlan.hillyArea,
        status: "active",
      })
      .returning();

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
    }

    // Queue gcal sync if connected (fire-and-forget — don't fail plan creation if sync fails)
    isConnected().then((connected) => {
      if (connected) {
        queuePlanWorkoutsSync(planId, "gcal").catch((err) => {
          console.error("Failed to queue gcal sync:", err);
        });
      }
    }).catch(() => {});

    // Return the full plan (weeks + workouts + blocks) by fetching from DB
    const fullPlan = await db.query.plans.findFirst({
      where: (p, { eq }) => eq(p.id, planId),
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

    return Response.json(fullPlan, { status: 201 });
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
        raceDistance: plans.raceDistance,
        raceDate: plans.raceDate,
      })
      .from(plans);

    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing plans:", err);
    return Response.json({ error: "Failed to fetch plans" }, { status: 500 });
  }
}
