import { db, workouts, strengthSessions } from "@/db";
import { isNotNull } from "drizzle-orm";
import { garminClient } from "@/lib/sync/garmin-client";

// ── POST /api/garmin/reconcile ───────────────────────────────────────────────
// Deletes workouts that exist on Garmin but that Kadenz no longer tracks —
// leftovers from regenerated plans, pre-fix duplicate moves, or deletions that
// happened while the sync queue was wedged. Kadenz is the source of truth:
// anything on the watch whose id we don't hold is stale by definition.

export async function POST() {
  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }

  try {
    const [runRows, strengthRows, onGarmin] = await Promise.all([
      db
        .select({ garminWorkoutId: workouts.garminWorkoutId })
        .from(workouts)
        .where(isNotNull(workouts.garminWorkoutId)),
      db
        .select({ garminWorkoutId: strengthSessions.garminWorkoutId })
        .from(strengthSessions)
        .where(isNotNull(strengthSessions.garminWorkoutId)),
      garminClient.listWorkouts(300),
    ]);

    const tracked = new Set<string>();
    for (const r of [...runRows, ...strengthRows]) {
      if (r.garminWorkoutId) tracked.add(r.garminWorkoutId);
    }

    const orphans = onGarmin.filter((w) => !tracked.has(w.garminWorkoutId));
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const orphan of orphans) {
      try {
        await garminClient.deleteWorkout(orphan.garminWorkoutId);
        deleted.push(orphan.garminWorkoutId);
      } catch (err) {
        failed.push({
          id: orphan.garminWorkoutId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return Response.json({
      ok: true,
      onGarmin: onGarmin.length,
      trackedByKadenz: tracked.size,
      deleted: deleted.length,
      failed,
    });
  } catch (err) {
    console.error("Garmin reconcile failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to reconcile" }, { status: 500 });
  }
}
