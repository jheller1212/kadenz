import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig } from "@/lib/sync/garmin-config";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── GET /api/garmin/status ────────────────────────────────────────────────────
// Worker deployment + health + the server-side "send workouts to watch" toggle.
//
// loadGarminConfig reads user_integration_state (tenanted, FORCE row level
// security) — needs withSession's transaction, same shape/fix as
// garmin/config and strava/disconnect. Before this, the toggle always
// answered `false` here regardless of what was actually stored.

export const GET = withSession(async () => {
  const userId = currentUserId();

  try {
    const configured = garminClient.isConfigured();
    const [healthy, authenticated, config] = await Promise.all([
      configured ? garminClient.healthCheck() : Promise.resolve(false),
      // Real auth state — "worker up" is not the same as "Garmin usable".
      configured ? garminClient.authOk() : Promise.resolve(false),
      loadGarminConfig(userId),
    ]);
    return Response.json({
      configured,
      healthy,
      // The card shows "Connected" only when Garmin actually answers; a dead
      // session surfaces "Reconnect" instead of a false green.
      authenticated,
      syncWorkouts: config.syncWorkouts,
    });
  } catch (err) {
    console.error("Garmin status error:", err);
    return Response.json({ error: "Failed to fetch Garmin status" }, { status: 500 });
  }
});
