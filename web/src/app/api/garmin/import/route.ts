import { type NextRequest } from "next/server";
import { garminClient, GarminAuthError } from "@/lib/sync/garmin-client";
import { runGarminImport } from "@/lib/sync/garmin-activity-import";
import { resolveRequestUserId } from "@/lib/request-user";

// ── POST /api/garmin/import ───────────────────────────────────────────────────
// Pull recent activities from the garmin-worker and store the new ones
// (dedupe against Strava arrivals). Also invoked by the daily cron.

export async function POST(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }

  try {
    const result = await runGarminImport(userId);
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof GarminAuthError) {
      return Response.json(
        { error: "garmin_auth", message: "Reconnect Garmin on the worker" },
        { status: 503 }
      );
    }
    console.error("Garmin import error:", err);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
