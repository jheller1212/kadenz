import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, activities, workouts } from "@/db";
import { queueWorkoutSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";

// ── POST /api/workouts/[workoutId]/record ─────────────────────────────────────
// A guided phone run finished with GPS: persist it as an activity (route +
// splits + duration) linked to the workout, and mark the workout complete. This
// is what makes a phone run show up in the Activities feed with a route map,
// the same as a Strava/Garmin import.

const SplitSchema = z.object({
  distance: z.number().nonnegative(),
  moving_time: z.number().int().nonnegative(),
  elapsed_time: z.number().int().nonnegative(),
});

const RecordSchema = z.object({
  distanceKm: z.number().positive().max(500),
  durationSeconds: z.number().int().positive().max(24 * 3600),
  polyline: z.string().max(100_000).optional(),
  splits: z.array(SplitSchema).max(500).optional(),
  startedAt: z.string().datetime().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ workoutId: string }> }
) {
  const { workoutId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = RecordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const data = parsed.data;

  try {
    const workout = await db.query.workouts.findFirst({
      where: (w, { eq: eqf }) => eqf(w.id, workoutId),
    });
    if (!workout) {
      return Response.json({ error: "Workout not found" }, { status: 404 });
    }

    const avgPaceSecKm = data.distanceKm > 0 ? Math.round(data.durationSeconds / data.distanceKm) : null;
    const startDate = data.startedAt
      ? new Date(data.startedAt)
      : new Date(Date.now() - data.durationSeconds * 1000);

    // Persist the run as an activity linked to this workout.
    const [activity] = await db
      .insert(activities)
      .values({
        workoutId,
        sportType: "Run",
        name: workout.title,
        distanceKm: data.distanceKm,
        durationSeconds: data.durationSeconds,
        avgPaceSecKm,
        startDate,
        splitsJson: data.splits ?? null,
        polyline: data.polyline ?? null,
      })
      .returning({ id: activities.id });

    // Mark the workout complete with what we actually did.
    await db
      .update(workouts)
      .set({
        status: "completed",
        actualKm: data.distanceKm,
        actualDurationSeconds: data.durationSeconds,
        updatedAt: new Date(),
      })
      .where(eq(workouts.id, workoutId));

    // Reflect completion on the calendar if connected.
    isConnected()
      .then((connected) => {
        if (connected) {
          queueWorkoutSync(workoutId, "update", "gcal").catch(() => {});
        }
      })
      .catch(() => {});

    return Response.json({ ok: true, activityId: activity?.id }, { status: 201 });
  } catch (err) {
    console.error("DB error recording guided run:", err);
    return Response.json({ error: "Failed to record run" }, { status: 500 });
  }
}
