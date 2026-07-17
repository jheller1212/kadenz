import { type NextRequest } from "next/server";
import { eq, and, lt } from "drizzle-orm";
import { db, syncOutbox } from "@/db";
import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { isGarminWorkoutSyncEnabled } from "@/lib/sync/garmin-config";
import { processGarminOutbox, queueGarminWindowSync } from "@/lib/sync/garmin-sync";
import { garminClient } from "@/lib/sync/garmin-client";
import { runGarminImport } from "@/lib/sync/garmin-activity-import";

// Failed jobs get one retry per cron run until this hard cap.
const RETRY_CAP = 10;

// ── GET /api/cron/gcal ────────────────────────────────────────────────────────
// The single daily cron (Vercel Hobby allows one — see vercel.json).
// Authenticated via CRON_SECRET. Does three things:
//   1. GCal: requeue failed jobs and drain the outbox (when connected).
//   2. Garmin push: roll the 14-day workout window forward + drain the garmin
//      outbox (when the worker is configured and the toggle is on).
//   3. Garmin import: pull new watch activities (auto-tick planned workouts).

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = { ok: true };

  try {
    // Give permanently-failed jobs another chance, up to RETRY_CAP attempts
    // (covers both gcal and garmin targets).
    const requeued = await db
      .update(syncOutbox)
      .set({ status: "pending" })
      .where(and(eq(syncOutbox.status, "failed"), lt(syncOutbox.attempts, RETRY_CAP)))
      .returning({ id: syncOutbox.id });
    out.requeued = requeued.length;

    if (await isConnected()) {
      out.gcal = await processGCalOutbox();
    } else {
      out.gcal = "not connected";
    }
  } catch (err) {
    console.error("GCal cron error:", err);
    out.gcalError = "failed";
  }

  try {
    if (await isGarminWorkoutSyncEnabled()) {
      out.garminQueued = await queueGarminWindowSync();
      out.garmin = await processGarminOutbox();
    } else {
      out.garmin = "disabled";
    }
  } catch (err) {
    console.error("Garmin cron sync error:", err);
    out.garminError = "sync failed";
  }

  try {
    // Activity import runs whenever the worker is deployed, independent of the
    // workout-push toggle (importing is read-only on Garmin's side).
    if (garminClient.isConfigured()) {
      out.garminImport = await runGarminImport();
    }
  } catch (err) {
    console.error("Garmin cron import error:", err);
    out.garminImportError = "import failed";
  }

  return Response.json(out);
}
