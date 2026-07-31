import { db, plans, weeks, workouts } from "@/db";
import { isSameLocalDay, localWeekRange } from "@/lib/app-time";
import { completedDistanceKm } from "@/lib/training/distance";
import { eq, and, desc } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";

// ── GET /api/today ────────────────────────────────────────────────────────────
// Returns the active plan's current week workouts + stats + week info

export const GET = withSession(async () => {
  try {
    // Find active plan
    const [activePlan] = await db
      .select({
        id: plans.id,
        raceDate: plans.raceDate,
        raceDistance: plans.raceDistance,
        planLengthWeeks: plans.planLengthWeeks,
        name: plans.name,
        intent: plans.intent,
      })
      .from(plans)
      .where(and(eq(plans.status, "active"), ownedBy(plans)))
      .limit(1);

    if (!activePlan) {
      return Response.json({ activePlan: false });
    }

    const now = new Date();

    // The athlete's week, not the server's: this runs in UTC, so local getters
    // would show yesterday's workout between midnight and 02:00 CEST.
    const { weekStart, weekEnd } = localWeekRange(now);

    let weekWorkouts = await db.query.workouts.findMany({
      where: (wo, { eq, and: andOp, between }) =>
        andOp(
          eq(wo.planId, activePlan.id),
          ownedBy(workouts),
          between(wo.date, weekStart, weekEnd)
        ),
      orderBy: (wo, { asc }) => [asc(wo.date), asc(wo.sortOrder)],
      // `activity` carries the measured avg pace for a completed, synced run —
      // the Today card needs it so it shows the ACHIEVED pace, not the block's
      // planned target (see lib/units.ts actualPaceSecKm).
      with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] }, activity: true },
    });

    // If no workouts this calendar week, find the first week with planned workouts
    if (weekWorkouts.length === 0) {
      const firstPlannedWorkout = await db.query.workouts.findFirst({
        where: (wo, { eq, and: andOp, gte }) =>
          andOp(
            eq(wo.planId, activePlan.id),
            ownedBy(workouts),
            gte(wo.date, new Date())
          ),
        orderBy: (wo, { asc }) => [asc(wo.date)],
      });

      if (firstPlannedWorkout) {
        // Get the week this workout belongs to, then fetch all workouts in that week
        const [weekRow] = await db
          .select({ id: weeks.id })
          .from(weeks)
          .where(and(eq(weeks.id, firstPlannedWorkout.weekId), ownedBy(weeks)))
          .limit(1);

        if (weekRow) {
          weekWorkouts = await db.query.workouts.findMany({
            where: (wo, { eq, and: andOp }) => andOp(eq(wo.weekId, weekRow.id), ownedBy(workouts)),
            orderBy: (wo, { asc }) => [asc(wo.date), asc(wo.sortOrder)],
            with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] }, activity: true },
          });
        }
      }
    }

    // The plan is over once it has no workouts this week and nothing left in
    // the future — race day passed (or the non-race block's end date did)
    // and nobody closed it out via the race-result flow or a new plan. Do
    // NOT fall through to "Week 1" below for this: that's the wrong week for
    // a plan that finished weeks ago, and it hides that anything is wrong.
    if (weekWorkouts.length === 0 && activePlan.raceDate < now) {
      const allPlanWorkouts = await db
        .select({
          type: workouts.type,
          status: workouts.status,
          targetKm: workouts.targetKm,
          actualKm: workouts.actualKm,
        })
        .from(workouts)
        .where(and(eq(workouts.planId, activePlan.id), ownedBy(workouts)));

      const completedRuns = allPlanWorkouts.filter(
        (w) => w.status === "completed" && w.type !== "rest"
      );
      const achievedKm = completedRuns.reduce((sum, w) => sum + completedDistanceKm(w), 0);

      const [raceWorkout] =
        activePlan.intent === "race"
          ? await db
              .select({ id: workouts.id, status: workouts.status })
              .from(workouts)
              .where(
                and(
                  eq(workouts.planId, activePlan.id),
                  ownedBy(workouts),
                  eq(workouts.type, "race")
                )
              )
              .orderBy(desc(workouts.date))
              .limit(1)
          : [];

      return Response.json({
        activePlan: true,
        planFinished: true,
        planId: activePlan.id,
        planName: activePlan.name,
        raceDistance: activePlan.raceDistance,
        raceDate: activePlan.raceDate,
        totalWeeks: activePlan.planLengthWeeks,
        // Only a race plan needs a result logged before it can be closed out
        // (see /api/workouts/[id]/race-result) — get_fit/maintain blocks just end.
        raceWorkoutId:
          activePlan.intent === "race" && raceWorkout && raceWorkout.status !== "completed"
            ? raceWorkout.id
            : null,
        achieved: {
          completedKm: Math.round(achievedKm * 10) / 10,
          completedRuns: completedRuns.length,
        },
      });
    }

    // Find the week number from the weeks table
    let currentWeekNumber = 1;
    if (weekWorkouts.length > 0) {
      const weekId = weekWorkouts[0].weekId;
      const [weekRow] = await db
        .select({ weekNumber: weeks.weekNumber })
        .from(weeks)
        .where(and(eq(weeks.id, weekId), ownedBy(weeks)))
        .limit(1);
      if (weekRow) currentWeekNumber = weekRow.weekNumber;
    }

    // Today's workout
    // A day can hold several rows — e.g. a workout rescheduled onto a day that
    // already had a rest placeholder. The real session always wins, whatever
    // sort order the moved row carried over from its old day.
    const todaysRows = weekWorkouts.filter((wo) =>
      isSameLocalDay(new Date(wo.date), now)
    );
    const todayWorkout =
      todaysRows.find((wo) => wo.type !== "rest") ?? todaysRows[0] ?? null;

    // Weekly stats
    const plannedKm = weekWorkouts.reduce((sum, w) => sum + (w.targetKm ?? 0), 0);
    const completedKm = weekWorkouts
      .filter((w) => w.status === "completed")
      .reduce((sum, w) => sum + completedDistanceKm(w), 0);
    const daysCompleted = weekWorkouts.filter((w) => w.status === "completed").length;
    const totalDays = weekWorkouts.filter((w) => w.type !== "rest").length;

    return Response.json({
      activePlan: true,
      planId: activePlan.id,
      planName: activePlan.name,
      raceDistance: activePlan.raceDistance,
      raceDate: activePlan.raceDate,
      currentWeek: currentWeekNumber,
      totalWeeks: activePlan.planLengthWeeks,
      todayWorkout,
      weekWorkouts,
      stats: {
        plannedKm: Math.round(plannedKm * 10) / 10,
        completedKm: Math.round(completedKm * 10) / 10,
        daysCompleted,
        totalDays,
      },
    });
  } catch (err) {
    console.error("DB error fetching today:", err);
    return Response.json({ error: "Failed to fetch today data" }, { status: 500 });
  }
});
