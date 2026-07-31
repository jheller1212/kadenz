import { NextRequest } from "next/server";
import { currentUserId } from "@/db/with-user";
import { z } from "zod";
import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig, saveGarminConfig } from "@/lib/sync/garmin-config";
import { queueGarminWindowSync } from "@/lib/sync/garmin-sync";
import { withSession } from "@/lib/api/with-session";

// ── /api/garmin/config ────────────────────────────────────────────────────────
// Server-side home of the "send workouts to watch" toggle. It must live in the
// DB (not localStorage) so the daily cron can read it.
//
// loadGarminConfig/saveGarminConfig read and write user_integration_state
// (Phase 4, tenanted, FORCE row level security), so this needs withSession's
// transaction and app.user_id, the same as every other tenanted route. Before
// this used resolveRequestUserId directly: GET silently read back the
// all-off default (the SELECT matched no rows, not an error), and POST's
// currentUserId() call — already written assuming a scope that was never
// opened — threw on every toggle-on, caught by the route's own try/catch and
// reported as "Failed to save Garmin config" after the save itself had
// already run outside RLS and inserted nothing.

const ConfigSchema = z.object({ syncWorkouts: z.boolean() }).strict();

export const GET = withSession(async () => {
  try {
    return Response.json(await loadGarminConfig(currentUserId()));
  } catch (err) {
    console.error("Garmin config read error:", err);
    return Response.json({ error: "Failed to read Garmin config" }, { status: 500 });
  }
});

export const POST = withSession(async (request: NextRequest) => {
  const userId = currentUserId();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = ConfigSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    await saveGarminConfig(userId, parsed.data);

    // Turning the toggle on pushes the current 14-day window right away
    // (fire-and-forget — the daily cron would catch up anyway).
    if (parsed.data.syncWorkouts && garminClient.isConfigured()) {
      queueGarminWindowSync(userId, userId).catch((err) =>
        console.error("Failed to queue Garmin window sync:", err)
      );
    }

    return Response.json(parsed.data);
  } catch (err) {
    console.error("Garmin config write error:", err);
    return Response.json({ error: "Failed to save Garmin config" }, { status: 500 });
  }
});
