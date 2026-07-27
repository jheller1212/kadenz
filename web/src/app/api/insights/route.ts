import { db, plans, weeks, workouts } from "@/db";
import { localWeekRange, localWeekdayIndex } from "@/lib/app-time";
import { completedDistanceKm } from "@/lib/training/distance";
import { eq } from "drizzle-orm";
import { workoutColor } from "@/lib/workout-colors";

// ── GET /api/insights ────────────────────────────────────────────────────────
// Returns mileage insights for two windows:
//  - "all": every workout due so far (plan start → today)
//  - "current": the current calendar week, whole week planned — the same
//    window the Today screen's mileage card uses, so the numbers match.

export async function GET() {
  try {
    const [activePlan] = await db
      .select({
        id: plans.id,
        name: plans.name,
        startDate: plans.startDate,
        planLengthWeeks: plans.planLengthWeeks,
      })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    if (!activePlan) {
      return Response.json({ activePlan: false });
    }

    const now = new Date();

    // Weeks and workouts both only depend on activePlan.id, not on each
    // other — fetch together instead of two serialised round trips.
    const [allWeeks, allWorkouts] = await Promise.all([
      db
        .select({
          id: weeks.id,
          weekNumber: weeks.weekNumber,
          targetKm: weeks.targetKm,
        })
        .from(weeks)
        .where(eq(weeks.planId, activePlan.id))
        .orderBy(weeks.weekNumber),

      db
        .select({
          id: workouts.id,
          weekId: workouts.weekId,
          type: workouts.type,
          status: workouts.status,
          targetKm: workouts.targetKm,
          actualKm: workouts.actualKm,
          date: workouts.date,
        })
        .from(workouts)
        .where(eq(workouts.planId, activePlan.id))
        .orderBy(workouts.date),
    ]);

    // "All" window: everything due so far (past + today, excluding rest days)
    const pastWorkouts = allWorkouts.filter(
      (w) => new Date(w.date) <= now && w.type !== "rest"
    );

    // "Current" window: the current calendar week, Monday-based — the whole
    // week counts as planned (same window as the Today screen's mileage card).
    // Same week definition as the Today screen — see lib/app-time.
    const { weekStart, weekEnd } = localWeekRange(now);
    const currentWorkouts = allWorkouts.filter((w) => {
      const d = new Date(w.date);
      return d >= weekStart && d < weekEnd && w.type !== "rest";
    });

    const types = ["easy", "tempo", "interval", "long", "race", "recovery"] as const;
    const typeLabels: Record<string, string> = {
      easy: "Easy Run",
      tempo: "Tempo",
      interval: "Intervals",
      long: "Long Run",
      race: "Race",
      recovery: "Recovery",
    };

    type WorkoutRow = (typeof allWorkouts)[number];
    function summarize(set: WorkoutRow[]) {
      const mileageByType: Array<{
        type: string;
        label: string;
        plannedKm: number;
        completedKm: number;
        pct: number;
        color: string;
      }> = [];
      for (const type of types) {
        const planned = set.filter((w) => w.type === type);
        if (planned.length === 0) continue;
        const plannedKm = planned.reduce((s, w) => s + (w.targetKm ?? 0), 0);
        const completedKm = planned
          .filter((w) => w.status === "completed")
          .reduce((s, w) => s + completedDistanceKm(w), 0);
        const pct = plannedKm > 0 ? Math.round((completedKm / plannedKm) * 100) : 0;
        mileageByType.push({
          type,
          label: typeLabels[type] ?? type,
          plannedKm: Math.round(plannedKm * 10) / 10,
          completedKm: Math.round(completedKm * 10) / 10,
          pct,
          color: workoutColor(type).solid,
        });
      }
      const totalPlannedKm = mileageByType.reduce((s, m) => s + m.plannedKm, 0);
      const totalCompletedKm = mileageByType.reduce((s, m) => s + m.completedKm, 0);
      const overallPct =
        totalPlannedKm > 0 ? Math.round((totalCompletedKm / totalPlannedKm) * 100) : 0;
      return {
        overallPct,
        mileageByType,
        totalPlanRuns: set.length,
        completedRuns: set.filter((w) => w.status === "completed").length,
        missedRuns: set.filter((w) => w.status === "missed" || w.status === "skipped").length,
      };
    }

    const allSummary = summarize(pastWorkouts);
    const currentSummary = summarize(currentWorkouts);

    // --- Status ---
    // Week verdict uses the SAME rule as the Today screen's mileage card:
    // completed share of this week's mileage vs how far into the week we are,
    // with a 15-point grace band.
    const dowIdx = localWeekdayIndex(now); // Mon=0 … Sun=6
    // Expect only the days BEFORE today: a run still scheduled for today
    // must not read as "behind" in the morning (counts from tomorrow).
    const expectedPct = Math.round(((dowIdx) / 7) * 100);
    const weekStatus =
      currentSummary.overallPct >= 100
        ? "complete"
        : currentSummary.overallPct + 15 >= expectedPct
        ? "on_track"
        : "behind";

    // Types lagging over the whole plan so far (subtitle detail).
    const behindTypes = allSummary.mileageByType
      .filter((m) => m.pct < 80 && m.plannedKm > 0)
      .map((m) => m.label);

    // --- Completed workouts per week ---
    const weekMap = new Map(allWeeks.map((w) => [w.id, w.weekNumber]));
    const weeklyWorkouts: Array<{
      weekNumber: number;
      workouts: Array<{ status: string; type: string }>;
    }> = [];

    // Group workouts by week (only past/current weeks)
    const workoutsByWeek = new Map<number, Array<{ status: string; type: string }>>();
    for (const wo of allWorkouts) {
      if (wo.type === "rest") continue;
      const weekNum = weekMap.get(wo.weekId);
      if (weekNum === undefined) continue;
      if (!workoutsByWeek.has(weekNum)) workoutsByWeek.set(weekNum, []);
      workoutsByWeek.get(weekNum)!.push({ status: wo.status, type: wo.type });
    }

    // Determine current week number
    const msFromStart = now.getTime() - new Date(activePlan.startDate).getTime();
    const currentWeekNum = Math.min(
      Math.floor(msFromStart / (7 * 24 * 60 * 60 * 1000)) + 1,
      activePlan.planLengthWeeks
    );

    for (const [weekNum, wos] of Array.from(workoutsByWeek.entries()).sort((a, b) => a[0] - b[0])) {
      if (weekNum > currentWeekNum) break;
      weeklyWorkouts.push({ weekNumber: weekNum, workouts: wos });
    }

    return Response.json({
      activePlan: true,
      planName: activePlan.name,
      startDate: activePlan.startDate,
      weekStart: weekStart.toISOString(),
      weekStatus,
      behindTypes,
      all: allSummary,
      current: currentSummary,
      weeklyWorkouts,
      currentWeekNum,
    });
  } catch (err) {
    console.error("DB error fetching insights:", err);
    return Response.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}
