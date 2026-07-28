import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { eq, and, lt } from "drizzle-orm";
import { db, syncOutbox } from "@/db";
import { processGCalOutbox } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { isGarminWorkoutSyncEnabled } from "@/lib/sync/garmin-config";
import {
  processGarminOutbox,
  queueGarminStrengthWindowSync,
  queueGarminWindowSync,
  resyncGarminWindow,
} from "@/lib/sync/garmin-sync";
import { garminClient } from "@/lib/sync/garmin-client";
import { runGarminImport } from "@/lib/sync/garmin-activity-import";
import { runWellnessSync } from "@/lib/sync/wellness-sync";
import { dispatchDueReminders } from "@/lib/reminders/dispatch";
import { pruneStaleAdhocSessions } from "@/lib/strength/schedule";

// Failed jobs get one retry per cron run until this hard cap.
const RETRY_CAP = 10;

// ── GET /api/cron/gcal ────────────────────────────────────────────────────────
// The single daily cron (Vercel Hobby allows one — see vercel.json).
// Authenticated via CRON_SECRET. Does three things:
//   1. GCal: requeue failed jobs and drain the outbox (when connected).
//   2. Garmin push: roll the 14-day workout window forward + drain the garmin
//      outbox (when the worker is configured and the toggle is on).
//   3. Garmin import: pull new watch activities (auto-tick planned workouts).
//   3b. Garmin wellness: pull overnight sleep/resting-HR/HRV for readiness
//      (see lib/sync/wellness-sync.ts) — read-only on Garmin's side, same as
//      activity import, so it runs whenever the worker is configured.
//   4. Workout reminders: push notifications for sessions inside their lead
//      window (when the athlete has opted in — see settings/reminders).
//      The real, frequent dispatch now runs from /api/cron/reminders via a
//      GitHub Actions schedule every 15 minutes (see that route and
//      .github/workflows/reminders.yml for why it lives there instead of a
//      second Vercel cron). Calling dispatchDueReminders here too is a cheap
//      safety net, not the primary path: it's idempotent (claim-before-send,
//      see dispatch.ts) and only catches sessions whose window happens to
//      overlap this once-a-day run, or the rare day the GitHub workflow is
//      broken end to end.

export async function GET(request: NextRequest) {
  // Either the cron secret (Vercel scheduler) or a signed-in session — the
  // latter so the owner can force a sync run instead of waiting a day when
  // something wedges.
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
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
      // Self-heal first: anything we pushed that has vanished from Garmin
      // gets recreated, then the window rolls forward as usual.
      out.garminResync = await resyncGarminWindow();
      out.garminQueued = await queueGarminWindowSync();
      // Kraft sessions ride the same rolling window as runs.
      out.garminStrengthQueued = await queueGarminStrengthWindowSync();
      out.garmin = await processGarminOutbox();
    } else {
      out.garmin = "disabled";
    }
  } catch (err) {
    console.error("Garmin cron sync error:", err);
    out.garminError = "sync failed";
  }

  try {
    // Abandoned Kraft-picker/custom-workout ad-hoc sessions (opened, never
    // started or logged, day now past) — DB hygiene independent of whether
    // Garmin is configured, since these can exist without ever having
    // reached the watch. See lib/strength/schedule.ts pruneStaleAdhocSessions.
    out.strengthAdhocPruned = await pruneStaleAdhocSessions();
  } catch (err) {
    console.error("Stale ad-hoc strength session prune error:", err);
    out.strengthAdhocPruneError = "prune failed";
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

  try {
    out.wellnessSync = await runWellnessSync();
  } catch (err) {
    console.error("Garmin wellness sync error:", err);
    out.wellnessSyncError = "sync failed";
  }

  try {
    out.reminders = await dispatchDueReminders();
  } catch (err) {
    console.error("Reminder dispatch error:", err);
    out.remindersError = "dispatch failed";
  }

  return Response.json(out);
}
