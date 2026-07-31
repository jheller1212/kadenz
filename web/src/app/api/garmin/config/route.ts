import { NextRequest } from "next/server";
import { currentUserId } from "@/db/with-user";
import { z } from "zod";
import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig, saveGarminConfig } from "@/lib/sync/garmin-config";
import { queueGarminWindowSync } from "@/lib/sync/garmin-sync";
import { resolveRequestUserId } from "@/lib/request-user";

// ── /api/garmin/config ────────────────────────────────────────────────────────
// Server-side home of the "send workouts to watch" toggle. It must live in the
// DB (not localStorage) so the daily cron can read it.

const ConfigSchema = z.object({ syncWorkouts: z.boolean() }).strict();

export async function GET(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
    return Response.json(await loadGarminConfig(userId));
  } catch (err) {
    console.error("Garmin config read error:", err);
    return Response.json({ error: "Failed to read Garmin config" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

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
      queueGarminWindowSync(currentUserId(), userId).catch((err) =>
        console.error("Failed to queue Garmin window sync:", err)
      );
    }

    return Response.json(parsed.data);
  } catch (err) {
    console.error("Garmin config write error:", err);
    return Response.json({ error: "Failed to save Garmin config" }, { status: 500 });
  }
}
