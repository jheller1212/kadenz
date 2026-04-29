import { db, plans, weeks } from "@/db";
import { eq, and } from "drizzle-orm";

// ── GET /api/today ────────────────────────────────────────────────────────────
// Returns the active plan's current week workouts + stats + week info

export async function GET() {
  try {
    // Find active plan
    const [activePlan] = await db
      .select({
        id: plans.id,
        raceDate: plans.raceDate,
        planLengthWeeks: plans.planLengthWeeks,
        name: plans.name,
      })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    if (!activePlan) {
      return Response.json({ activePlan: false });
    }

    const now = new Date();

    // Fetch workouts for the current calendar week (Mon–Sun)
    const dayOfWeek = now.getDay(); // 0=Sun
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() + mondayOffset);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    const weekWorkouts = await db.query.workouts.findMany({
      where: (wo, { eq, and, between }) =>
        and(
          eq(wo.planId, activePlan.id),
          between(wo.date, weekStart, weekEnd)
        ),
      orderBy: (wo, { asc }) => [asc(wo.date), asc(wo.sortOrder)],
      with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
    });

    // Find the week number from the weeks table
    let currentWeekNumber = 1;
    if (weekWorkouts.length > 0) {
      const weekId = weekWorkouts[0].weekId;
      const [weekRow] = await db
        .select({ weekNumber: weeks.weekNumber })
        .from(weeks)
        .where(eq(weeks.id, weekId))
        .limit(1);
      if (weekRow) currentWeekNumber = weekRow.weekNumber;
    }

    // Today's workout
    const todayWorkout =
      weekWorkouts.find((wo) => {
        const d = new Date(wo.date);
        return (
          d.getFullYear() === now.getFullYear() &&
          d.getMonth() === now.getMonth() &&
          d.getDate() === now.getDate()
        );
      }) ?? null;

    // Weekly stats
    const plannedKm = weekWorkouts.reduce((sum, w) => sum + (w.targetKm ?? 0), 0);
    const completedKm = weekWorkouts
      .filter((w) => w.status === "completed")
      .reduce((sum, w) => sum + (w.actualKm ?? w.targetKm ?? 0), 0);
    const daysCompleted = weekWorkouts.filter((w) => w.status === "completed").length;
    const totalDays = weekWorkouts.filter((w) => w.type !== "rest").length;

    return Response.json({
      activePlan: true,
      planId: activePlan.id,
      planName: activePlan.name,
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
}
