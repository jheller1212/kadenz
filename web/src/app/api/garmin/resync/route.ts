import { resyncGarminWindow } from "@/lib/sync/garmin-sync";
import { garminClient } from "@/lib/sync/garmin-client";

// ── POST /api/garmin/resync ──────────────────────────────────────────────────
// Re-push whatever is missing on Garmin. Purely additive: workouts Kadenz
// pushed that have since disappeared are recreated. Nothing is deleted here.

export async function POST() {
  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }
  try {
    const result = await resyncGarminWindow();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("Garmin resync failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to resync" }, { status: 500 });
  }
}
