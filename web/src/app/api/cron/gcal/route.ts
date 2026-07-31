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
import { pruneStaleAdhocSessions, autoCloseAbandonedSessions } from "@/lib/strength/schedule";
import { listAllUserIds } from "@/lib/users";
import { asUserId } from "@/lib/user-id";

// Failed jobs get one retry per cron run until this hard cap.
const RETRY_CAP = 10;

/**
 * The subset of `userIds` for which `predicate` holds.
 *
 * Sequential rather than Promise.all: these predicates each hit the database,
 * and the pooled client is capped at one connection per function instance, so
 * firing them together would queue on the pool anyway while making a single
 * failure harder to attribute to a user.
 */
async function filterUsers(
  userIds: string[],
  predicate: (userId: string) => Promise<boolean>
): Promise<string[]> {
  const out: string[] = [];
  for (const userId of userIds) {
    try {
      if (await predicate(userId)) out.push(userId);
    } catch (err) {
      console.error(`Connection check failed for user ${userId}:`, err);
    }
  }
  return out;
}

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

  // A cron run carries no session, so it has no single user to act as. Every
  // integration it touches is now per person, so it fans out over users.
  // Superseded by withCronFanOut once phase 3 lands; see lib/users.ts.
  let userIds: string[];
  try {
    userIds = await listAllUserIds();
  } catch (err) {
    console.error("GCal cron could not list users:", err);
    return Response.json({ ok: false, error: "user list failed" }, { status: 500 });
  }

  try {
    // Give permanently-failed jobs another chance, up to RETRY_CAP attempts
    // (covers both gcal and garmin targets).
    const requeued = await db
      .update(syncOutbox)
      .set({ status: "pending" })
      .where(and(eq(syncOutbox.status, "failed"), lt(syncOutbox.attempts, RETRY_CAP)))
      .returning({ id: syncOutbox.id });
    out.requeued = requeued.length;

    // "Is a calendar connected" is now a per-person fact, so the gate asks
    // whether ANYONE is connected. The drain itself stays global on purpose:
    // every outbox row records its own owner and is delivered with that
    // owner's credentials, so one drain correctly serves everybody.
    const connected = await filterUsers(userIds, isConnected);
    if (connected.length > 0) {
      out.gcal = await processGCalOutbox();
    } else {
      out.gcal = "not connected";
    }
  } catch (err) {
    console.error("GCal cron error:", err);
    out.gcalError = "failed";
  }

  try {
    // Garmin is reached through installation-level worker credentials rather
    // than per-user OAuth, so in practice only the owner has a watch. The loop
    // is still per user because the toggle and the queueing are per user, and
    // a user with the toggle off simply contributes nothing.
    const enabled = await filterUsers(userIds, isGarminWorkoutSyncEnabled);
    if (enabled.length > 0) {
      let repushed = 0;
      let queued = 0;
      let strengthQueued = 0;
      for (const userId of enabled) {
        try {
          // Self-heal first: anything we pushed that has vanished from Garmin
          // gets recreated, then the window rolls forward as usual.
          const resync = await resyncGarminWindow(userId);
          repushed += resync.repushed;
          // Cron has no request session, so the acting user is whichever id
          // this loop iteration is currently fanning out over, not
          // currentUserId() (there is no request context here to read it
          // from). userId came off the users table via listAllUserIds, so it
          // is validated, not cast.
          queued += await queueGarminWindowSync(asUserId(userId));
          // Kraft sessions ride the same rolling window as runs.
          strengthQueued += await queueGarminStrengthWindowSync(userId);
        } catch (err) {
          // Per user, so one athlete's Garmin outage cannot skip everyone
          // queued behind them.
          console.error(`Garmin window sync failed for user ${userId}:`, err);
        }
      }
      out.garminResync = repushed;
      out.garminQueued = queued;
      out.garminStrengthQueued = strengthQueued;
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
    // Backstop only — the real path is the 15-minute sync-drain cron (see
    // that route). Cheap and idempotent, so calling it again here is harmless
    // on a normal day and catches abandoned sessions if that faster cron is
    // ever broken end to end (same reasoning as dispatchDueReminders below).
    out.strengthAutoClosed = await autoCloseAbandonedSessions();
  } catch (err) {
    console.error("Strength auto-close cron error:", err);
    out.strengthAutoCloseError = "auto-close failed";
  }

  try {
    // Activity import runs whenever the worker is deployed, independent of the
    // workout-push toggle (importing is read-only on Garmin's side).
    if (garminClient.isConfigured()) {
      // Per user because the import bookmark is per user. That is the whole
      // point of migration 0059: with one shared bookmark, each iteration
      // would overwrite the previous one's position and every athlete would
      // re-import or skip activities depending on who ran last.
      const imports: Record<string, unknown> = {};
      for (const userId of userIds) {
        try {
          imports[userId] = await runGarminImport(asUserId(userId));
        } catch (err) {
          console.error(`Garmin import failed for user ${userId}:`, err);
          imports[userId] = "failed";
        }
      }
      out.garminImport = imports;
    }
  } catch (err) {
    console.error("Garmin cron import error:", err);
    out.garminImportError = "import failed";
  }

  try {
    const wellness: Record<string, unknown> = {};
    for (const userId of userIds) {
      try {
        wellness[userId] = await runWellnessSync(asUserId(userId));
      } catch (err) {
        console.error(`Wellness sync failed for user ${userId}:`, err);
        wellness[userId] = "failed";
      }
    }
    out.wellnessSync = wellness;
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
