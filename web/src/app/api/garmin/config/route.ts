import { NextRequest } from "next/server";
import { z } from "zod";
import { garminClient } from "@/lib/sync/garmin-client";
import { loadGarminConfig, saveGarminConfig } from "@/lib/sync/garmin-config";
import { queueGarminWindowSync } from "@/lib/sync/garmin-sync";

// ── /api/garmin/config ────────────────────────────────────────────────────────
// Server-side home of the "send workouts to watch" toggle. It must live in the
// DB (not localStorage) so the daily cron can read it.

const ConfigSchema = z.object({ syncWorkouts: z.boolean() }).strict();

export async function GET() {
  try {
    return Response.json(await loadGarminConfig());
  } catch (err) {
    console.error("Garmin config read error:", err);
    return Response.json({ error: "Failed to read Garmin config" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
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
    await saveGarminConfig(parsed.data);

    // Turning the toggle on pushes the current 14-day window right away
    // (fire-and-forget — the daily cron would catch up anyway).
    if (parsed.data.syncWorkouts && garminClient.isConfigured()) {
      queueGarminWindowSync().catch((err) =>
        console.error("Failed to queue Garmin window sync:", err)
      );
    }

    return Response.json(parsed.data);
  } catch (err) {
    console.error("Garmin config write error:", err);
    return Response.json({ error: "Failed to save Garmin config" }, { status: 500 });
  }
}
