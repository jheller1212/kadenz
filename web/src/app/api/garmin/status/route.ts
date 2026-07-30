import { type NextRequest } from "next/server";
import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig } from "@/lib/sync/garmin-config";
import { resolveRequestUserId } from "@/lib/request-user";

// ── GET /api/garmin/status ────────────────────────────────────────────────────
// Worker deployment + health + the server-side "send workouts to watch" toggle.

export async function GET(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
}
