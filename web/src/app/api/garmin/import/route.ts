import { garminClient, GarminAuthError } from "@/lib/sync/garmin-client";
import { runGarminImport } from "@/lib/sync/garmin-activity-import";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";

// ── POST /api/garmin/import ───────────────────────────────────────────────────
// Pull recent activities from the garmin-worker and store the new ones
// (dedupe against Strava arrivals). Also invoked by the daily cron (see
// /api/cron/gcal, which fans out over users itself and calls
// runGarminImport directly inside its own per-user loop, not through this
// HTTP route).
//
// runGarminImport writes `activities` (tenanted, FORCE row level security),
// so it needs withSession's transaction the same as every other route here.
// It makes exactly one external call (garminClient.listActivities) before
// its per-activity loop is DB-only, so holding the transaction for the whole
// handler doesn't hold it over a slow multi-call round trip the way
// strava/backfill's per-activity Strava fetches would.

export const POST = withSession(async () => {
  const userId = currentUserId();

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
});
