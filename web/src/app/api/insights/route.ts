import { db, plans, weeks, workouts } from "@/db";
import { eq, and, lte } from "drizzle-orm";

// ── GET /api/insights ────────────────────────────────────────────────────────
// Returns mileage insights: per-type completion %, per-week workout status

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

    // Get all weeks
    const allWeeks = await db
      .select({
        id: weeks.id,
        weekNumber: weeks.weekNumber,
        targetKm: weeks.targetKm,
      })
      .from(weeks)
      .where(eq(weeks.planId, activePlan.id))
      .orderBy(weeks.weekNumber);

    // Get all workouts up to today (past + current)
    const allWorkouts = await db
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
      .orderBy(workouts.date);

    // Split into past (up to today) and all
    const pastWorkouts = allWorkouts.filter(
      (w) => new Date(w.date) <= now && w.type !== "rest"
    );

    // --- Completed mileage by type ---
    const types = ["easy", "tempo", "interval", "long", "race", "recovery"] as const;
    const mileageByType: Array<{
      type: string;
      label: string;
      plannedKm: number;
      completedKm: number;
      pct: number;
      color: string;
    }> = [];

    const typeLabels: Record<string, string> = {
      easy: "Easy Run",
      tempo: "Tempo",
      interval: "Intervals",
      long: "Long Run",
      race: "Race",
      recovery: "Recovery",
    };

    const typeColors: Record<string, string> = {
      easy: "#4ADE80",
      tempo: "#FFB547",
      interval: "#C084FC",
      long: "#60A5FA",
      race: "#FF4D4D",
      recovery: "#4ADE80",
    };

    for (const type of types) {
      const planned = pastWorkouts.filter((w) => w.type === type);
      if (planned.length === 0) continue;

      const plannedKm = planned.reduce((s, w) => s + (w.targetKm ?? 0), 0);
      const completedKm = planned
        .filter((w) => w.status === "completed")
        .reduce((s, w) => s + (w.actualKm ?? w.targetKm ?? 0), 0);

      const pct = plannedKm > 0 ? Math.round((completedKm / plannedKm) * 100) : 0;

      mileageByType.push({
        type,
        label: typeLabels[type] ?? type,
        plannedKm: Math.round(plannedKm * 10) / 10,
        completedKm: Math.round(completedKm * 10) / 10,
        pct,
        color: typeColors[type] ?? "#999",
      });
    }

    // Overall completion
    const totalPlannedKm = mileageByType.reduce((s, m) => s + m.plannedKm, 0);
    const totalCompletedKm = mileageByType.reduce((s, m) => s + m.completedKm, 0);
    const overallPct = totalPlannedKm > 0 ? Math.round((totalCompletedKm / totalPlannedKm) * 100) : 0;

    // --- Behind warning ---
    const behindTypes = mileageByType
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

    // Count totals
    const totalPlanRuns = pastWorkouts.length;
    const completedRuns = pastWorkouts.filter((w) => w.status === "completed").length;
    const missedRuns = pastWorkouts.filter(
      (w) => w.status === "missed" || (w.status === "skipped")
    ).length;

    return Response.json({
      activePlan: true,
      planName: activePlan.name,
      startDate: activePlan.startDate,
      overallPct,
      totalPlanRuns,
      completedRuns,
      missedRuns,
      mileageByType,
      behindTypes,
      weeklyWorkouts,
      currentWeekNum,
    });
  } catch (err) {
    console.error("DB error fetching insights:", err);
    return Response.json({ error: "Failed to fetch insights" }, { status: 500 });
  }
}
