import { NextRequest } from "next/server";
import { db, plans, activities, strengthSessions, strengthSets } from "@/db";
import { eq, desc, isNull, and, inArray, isNotNull } from "drizzle-orm";
import { getActiveProfileId } from "@/lib/profiles";

export async function GET(request: NextRequest) {
  const profileId = getActiveProfileId(request);
  try {
    // 1. Get all Strava activities (the real data). Strava is the owner's
    //    device — guest profiles see only their own in-app sessions.
    const allActivities = profileId
      ? []
      : await db
          // Only what the list renders. `select()` also pulled splitsJson,
          // lapsJson, polyline and aiInsight — megabytes of per-activity JSON
          // that nothing here reads (the detail route fetches those).
          .select({
            id: activities.id,
            stravaId: activities.stravaId,
            garminId: activities.garminId,
            sportType: activities.sportType,
            name: activities.name,
            startDate: activities.startDate,
            distanceKm: activities.distanceKm,
            durationSeconds: activities.durationSeconds,
            avgPaceSecKm: activities.avgPaceSecKm,
            avgHr: activities.avgHr,
            maxHr: activities.maxHr,
            elevationGain: activities.elevationGain,
            workoutId: activities.workoutId,
            strengthSessionId: activities.strengthSessionId,
            createdAt: activities.createdAt,
          })
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
    const strengthRows = await db
      .select()
      .from(strengthSessions)
      .where(
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      );
    const sessionMap = new Map(strengthRows.map((s) => [s.id, s]));

    // Which sessions actually logged at least one set (reps recorded). Sessions
    // with zero logged sets are treated as never-really-done and kept out of the
    // standalone strength feed below.
    const sessionsWithSets = new Set<string>();
    if (strengthRows.length > 0) {
      const setRows = await db
        .selectDistinct({ sessionId: strengthSets.sessionId })
        .from(strengthSets)
        .where(
          and(
            inArray(
              strengthSets.sessionId,
              strengthRows.map((s) => s.id)
            ),
            isNotNull(strengthSets.reps)
          )
        );
      for (const r of setRows) sessionsWithSets.add(r.sessionId);
    }

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
    // A stale planned session is a duplicate when a completed session of the
    // same type exists on the same day (the workout happened — via an ad-hoc
    // start — and the planned row was simply left behind). Hide it.
    const completedDayType = new Set(
      strengthRows
        .filter((s) => s.status === "completed")
        .map((s) => `${new Date(s.date).toDateString()}:${s.type}`)
    );
    const strengthItems = strengthRows
      .filter((s) => !linkedSessionIds.has(s.id))
      .filter((s) => s.status === "completed" || (s.status === "planned" && new Date(s.date) < now))
      .filter(
        (s) =>
          s.status === "completed" ||
          !completedDayType.has(`${new Date(s.date).toDateString()}:${s.type}`)
      )
      // Completed sessions always show (a manual tick is a real workout);
      // otherwise require logged sets so opened-but-empty ones don't clutter.
      .filter((s) => s.status === "completed" || sessionsWithSets.has(s.id))
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
