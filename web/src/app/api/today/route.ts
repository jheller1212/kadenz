import { db, plans } from "@/db";
import { eq } from "drizzle-orm";

// ── GET /api/today ────────────────────────────────────────────────────────────
// Returns the active plan's current week workouts + stats

export async function GET() {
  try {
    // Find active plan
    const [activePlan] = await db
      .select({ id: plans.id, raceDate: plans.raceDate })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    if (!activePlan) {
      return Response.json({ activePlan: false });
    }

    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

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

    // Today's workout: the one matching today's date (or next upcoming)
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
