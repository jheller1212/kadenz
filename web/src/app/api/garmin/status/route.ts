import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig } from "@/lib/sync/garmin-config";

// ── GET /api/garmin/status ────────────────────────────────────────────────────
// Worker deployment + health + the server-side "send workouts to watch" toggle.

export async function GET() {
  try {
    const configured = garminClient.isConfigured();
    const [healthy, config] = await Promise.all([
      configured ? garminClient.healthCheck() : Promise.resolve(false),
      loadGarminConfig(),
    ]);
    return Response.json({
      configured,
      healthy,
      syncWorkouts: config.syncWorkouts,
    });
  } catch (err) {
    console.error("Garmin status error:", err);
    return Response.json({ error: "Failed to fetch Garmin status" }, { status: 500 });
  }
}
