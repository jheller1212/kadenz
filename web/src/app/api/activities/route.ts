import { db, plans, workouts, activities } from "@/db";
import { eq, desc, isNull } from "drizzle-orm";

export async function GET() {
  try {
    // 1. Get all Strava activities (the real data)
    const allActivities = await db
      .select()
      .from(activities)
      .orderBy(desc(activities.startDate), desc(activities.createdAt));

    // 2. Get active plan for linking workout details
    const [activePlan] = await db
      .select({ id: plans.id, name: plans.name })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    // 3. For activities linked to workouts, fetch workout details
    const linkedWorkoutIds = allActivities
      .filter((a) => a.workoutId)
      .map((a) => a.workoutId!);

    let workoutMap = new Map<
      string,
      { type: string; title: string; blocks: unknown[] }
    >();

    if (linkedWorkoutIds.length > 0) {
      const linkedWorkouts = await db.query.workouts.findMany({
        where: (wo, { inArray }) => inArray(wo.id, linkedWorkoutIds),
        with: {
          blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
        },
      });
      for (const wo of linkedWorkouts) {
        workoutMap.set(wo.id, {
          type: wo.type,
          title: wo.title,
          blocks: wo.blocks,
        });
      }
    }

    // 4. Also get planned (future) workouts that haven't been completed yet
    let plannedWorkouts: Array<{
      id: string;
      type: string;
      title: string;
      date: Date;
      status: string;
      targetKm: number | null;
      targetDurationMinutes: number | null;
      blocks: unknown[];
    }> = [];

    if (activePlan) {
      const planned = await db.query.workouts.findMany({
        where: (wo, { and, eq }) =>
          and(eq(wo.planId, activePlan.id), eq(wo.status, "planned")),
        orderBy: (wo, { desc }) => [desc(wo.date)],
        with: {
          blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
        },
      });
      // Only include planned workouts in the past (missed) — not future ones
      const now = new Date();
      plannedWorkouts = planned
        .filter((wo) => new Date(wo.date) < now && wo.type !== "rest")
        .map((wo) => ({
          id: wo.id,
          type: wo.type,
          title: wo.title,
          date: wo.date,
          status: wo.status,
          targetKm: wo.targetKm,
          targetDurationMinutes: wo.targetDurationMinutes,
          blocks: wo.blocks,
        }));
    }

    // 5. Build unified response — real activities first
    const activityItems = allActivities.map((a) => {
      const linked = a.workoutId ? workoutMap.get(a.workoutId) : null;
      return {
        id: a.id,
        source: "strava" as const,
        stravaId: a.stravaId,
        date: (a.startDate ?? a.createdAt).toISOString(),
        type: linked?.type ?? "run",
        title: a.name ?? linked?.title ?? "Run",
        distanceKm: a.distanceKm,
        durationSeconds: a.durationSeconds,
        avgPaceSecKm: a.avgPaceSecKm,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        elevationGain: a.elevationGain,
        status: "completed",
        workoutId: a.workoutId,
        activity: {
          id: a.id,
          stravaId: a.stravaId,
          distanceKm: a.distanceKm,
          durationSeconds: a.durationSeconds,
          avgPaceSecKm: a.avgPaceSecKm,
          avgHr: a.avgHr,
          maxHr: a.maxHr,
        },
        blocks: linked?.blocks ?? [],
      };
    });

    return Response.json({
      activities: activityItems,
      plannedWorkouts,
      planName: activePlan?.name ?? null,
    });
  } catch (err) {
    console.error("DB error fetching activities:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
