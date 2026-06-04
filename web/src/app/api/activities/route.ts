import { db, plans, workouts } from "@/db";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const [activePlan] = await db
      .select({ id: plans.id, name: plans.name })
      .from(plans)
      .where(eq(plans.status, "active"))
      .limit(1);

    if (!activePlan) return Response.json({ workouts: [] });

    const allWorkouts = await db.query.workouts.findMany({
      where: (wo, { eq }) => eq(wo.planId, activePlan.id),
      orderBy: (wo, { desc }) => [desc(wo.date)],
      with: {
        blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] },
        activity: true,
      },
    });

    return Response.json({ workouts: allWorkouts, planName: activePlan.name });
  } catch (err) {
    console.error("DB error fetching activities:", err);
    return Response.json({ error: "Failed to fetch" }, { status: 500 });
  }
}
