import { NextRequest } from "next/server";
import { garminClient } from "@/lib/sync/garmin-client";
import { withSession } from "@/lib/api/with-session";
import { requireOwned } from "@/lib/api/owned";
import { activities } from "@/db";

// ── GET /api/activities/[id]/exercise-order ───────────────────────────────────
// The exercises the athlete actually performed, in order, from the linked Garmin
// activity's on-watch rep tracking. Empty when there's no Garmin link or the
// watch recorded no per-exercise data — the caller then keeps the plan order.
// "No stored order" and "not your activity" are different facts: only the
// first gets the empty list, the second is a 404 like every other route here.

export const GET = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Outside the try below so its 404 reaches withSession directly.
  const activity = await requireOwned(activities, id);

  try {
    if (!activity.garminId || !garminClient.isConfigured()) {
      return Response.json({ exercises: [] });
    }
    const exercises = await garminClient.getExerciseSets(activity.garminId);
    return Response.json({ exercises });
  } catch (err) {
    console.error("[exercise-order] failed", err);
    return Response.json({ exercises: [] });
  }
});
