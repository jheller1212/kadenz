import { NextRequest } from "next/server";
import { db, workouts } from "@/db";
import { withSession } from "@/lib/api/with-session";
import { requireOwned } from "@/lib/api/owned";

// ── GET /api/workouts/[workoutId] ─────────────────────────────────────────────
// Returns a single workout with its blocks — used by the workout detail screen
// so deep links work for any week, not just the current one.

export const GET = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) => {
  const { workoutId } = await params;

  // Was previously unscoped: any signed-in caller could read any workout's
  // detail (including a completed run's actual pace) by guessing its id.
  await requireOwned(workouts, workoutId);

  try {
    const workout = await db.query.workouts.findFirst({
      where: (wo, { eq }) => eq(wo.id, workoutId),
      // `activity` carries the measured avg pace for a completed, synced run
      // — the detail screen's "actual" section needs it (see units.ts
      // actualPaceSecKm) rather than showing the block's planned target.
      with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] }, activity: true },
    });

    if (!workout) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    return Response.json(workout);
  } catch (err) {
    console.error("DB error fetching workout:", err);
    return Response.json({ error: "Failed to fetch workout" }, { status: 500 });
  }
});
