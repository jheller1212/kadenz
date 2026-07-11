import { db, plans, activities, strengthSessions } from "@/db";
import { eq, desc } from "drizzle-orm";

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

    const workoutMap = new Map<
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

    // 5. Strength sessions — for a unified feed and to enrich linked activities.
    const strengthRows = await db.select().from(strengthSessions);
    const sessionMap = new Map(strengthRows.map((s) => [s.id, s]));

    // 6. Build unified response — recorded activities first (runs + strength).
    const activityItems = allActivities.map((a) => {
      const linkedRun = a.workoutId ? workoutMap.get(a.workoutId) : null;
      const linkedSession = a.strengthSessionId ? sessionMap.get(a.strengthSessionId) : null;
      const isStrength = !!linkedSession || a.sportType === "WeightTraining" || a.sportType === "Workout" || a.sportType === "Crossfit" || a.sportType === "HIIT";
      return {
        id: a.id,
        source: "strava" as const,
        kind: isStrength ? "strength" : "run",
        stravaId: a.stravaId,
        date: (a.startDate ?? a.createdAt).toISOString(),
        type: isStrength ? "strength" : linkedRun?.type ?? "run",
        strengthType: linkedSession?.type ?? null,
        title: linkedSession?.title ?? a.name ?? linkedRun?.title ?? (isStrength ? "Strength" : "Run"),
        distanceKm: a.distanceKm,
        durationSeconds: a.durationSeconds,
        avgPaceSecKm: a.avgPaceSecKm,
        avgHr: a.avgHr,
        maxHr: a.maxHr,
        elevationGain: a.elevationGain,
        status: "completed",
        workoutId: a.workoutId,
        strengthSessionId: a.strengthSessionId,
        activity: {
          id: a.id,
          stravaId: a.stravaId,
          distanceKm: a.distanceKm,
          durationSeconds: a.durationSeconds,
          avgPaceSecKm: a.avgPaceSecKm,
          avgHr: a.avgHr,
          maxHr: a.maxHr,
        },
        blocks: linkedRun?.blocks ?? [],
      };
    });

    // 7. Strength sessions without a recorded activity → standalone feed items
    //    (completed in-app, or past-planned = missed). Future ones are skipped.
    const now = new Date();
    const linkedSessionIds = new Set(
      allActivities.filter((a) => a.strengthSessionId).map((a) => a.strengthSessionId!)
    );
    const strengthItems = strengthRows
      .filter((s) => !linkedSessionIds.has(s.id))
      .filter((s) => s.status === "completed" || (s.status === "planned" && new Date(s.date) < now))
      .map((s) => ({
        id: `strength:${s.id}`,
        source: "session" as const,
        kind: "strength" as const,
        stravaId: null,
        date: new Date(s.date).toISOString(),
        type: "strength",
        strengthType: s.type,
        title: s.title,
        distanceKm: null,
        durationSeconds: s.durationMinutes ? s.durationMinutes * 60 : null,
        avgPaceSecKm: null,
        avgHr: null,
        maxHr: null,
        elevationGain: null,
        status: s.status,
        workoutId: null,
        strengthSessionId: s.id,
        activity: null,
        blocks: [],
      }));

    const unified = [...activityItems, ...strengthItems].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    return Response.json({
      activities: unified,
      plannedWorkouts,
      planName: activePlan?.name ?? null,
    });
  } catch (err) {
    console.error("DB error fetching activities:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
