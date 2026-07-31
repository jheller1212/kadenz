import { resyncGarminWindow } from "@/lib/sync/garmin-sync";
import { garminClient } from "@/lib/sync/garmin-client";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── POST /api/garmin/resync ──────────────────────────────────────────────────
// Re-push whatever is missing on Garmin. Purely additive: workouts Kadenz
// pushed that have since disappeared are recreated. Nothing is deleted here.
//
// resyncGarminWindow reads/writes `workouts`/`strength_sessions` (tenanted,
// FORCE row level security) after one external call (listWorkouts), so it
// needs withSession's transaction and is safe to hold it for, same reasoning
// as garmin/import.

export const POST = withSession(async () => {
  const userId = currentUserId();

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }
  try {
    const result = await resyncGarminWindow(userId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Garmin resync failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to resync" }, { status: 500 });
  }
});
