import { NextRequest } from "next/server";
import { db } from "@/db";

// ── GET /api/workouts/[workoutId] ─────────────────────────────────────────────
// Returns a single workout with its blocks — used by the workout detail screen
// so deep links work for any week, not just the current one.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) {
  const { workoutId } = await params;

  try {
    const workout = await db.query.workouts.findFirst({
      where: (wo, { eq }) => eq(wo.id, workoutId),
      with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
    });

    if (!workout) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    return Response.json(workout);
  } catch (err) {
    console.error("DB error fetching workout:", err);
    return Response.json({ error: "Failed to fetch workout" }, { status: 500 });
  }
}
