import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, activities } from "@/db";
import { garminClient } from "@/lib/sync/garmin-client";

// ── GET /api/activities/[id]/exercise-order ───────────────────────────────────
// The exercises the athlete actually performed, in order, from the linked Garmin
// activity's on-watch rep tracking. Empty when there's no Garmin link or the
// watch recorded no per-exercise data — the caller then keeps the plan order.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [activity] = await db
      .select({ garminId: activities.garminId })
      .from(activities)
      .where(eq(activities.id, id));

    if (!activity?.garminId || !garminClient.isConfigured()) {
      return Response.json({ exercises: [] });
    }
    const exercises = await garminClient.getExerciseSets(activity.garminId);
    return Response.json({ exercises });
  } catch (err) {
    console.error("[exercise-order] failed", err);
    return Response.json({ exercises: [] });
  }
}
