import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { eq, and, lt } from "drizzle-orm";
import { db, syncOutbox, OWNER_USER_ID } from "@/db";
import { forEachUser, withUser } from "@/db/with-user";
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
import { asUserId } from "@/lib/user-id";

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
//
// ── Per-user scope, and the two drains that deliberately stay outside it ────
//
// Every read/write under FORCE row level security (drizzle/0053_rls.sql,
// 0066_rls_covers_every_tenanted_table.sql) needs an app.user_id set on the
// transaction it runs on, or it matches nothing (db/with-user.ts). A cron run
// carries no session, so there is no single user to act as, and most of what
// this route does is genuinely per person: is THIS user's calendar connected,
// has THIS user turned on watch sync, prune THIS user's stale sessions. Those
// blocks fan out over every user via forEachUser, each iteration running
// inside that user's own transaction.
//
// Two calls do not fit that shape and are left unscoped, on purpose, not by
// oversight: processGCalOutbox() and processGarminOutbox() each drain a
// single outbox spanning every user's queued jobs in one claim (FOR UPDATE
// SKIP LOCKED), because a job row already carries its own owner and there is
// no way to split "drain everyone's outbox" into one transaction per user
// without either claiming the same table N times or reinventing the claim
// inside a loop. Under FORCE RLS an unscoped claim matches nothing, so these
// two calls do not drain anything in production today. That is a real
// architectural gap — one transaction can only carry one app.user_id, and an
// outbox drain is intentionally cross-user — and it needs a decision (e.g. a
// service-role connection scoped to sync_outbox specifically, or reshaping
// the drain to claim per user) rather than a mechanical fix here. Left as is,
// flagged loudly rather than silently patched over. The failed-job requeue
// just above them has the same shape and the same gap.
//
// Garmin is reached through one installation-level worker connection, not
// per-user OAuth (see garmin-config.ts), so only the owner's rows can ever
// legitimately carry a garminWorkoutId. The push/resync block below mirrors
// sync/reconcile-garmin's shape for that reason: it does not fan out the
// actual push over every enabled user, it runs once, for the owner, inside
// the owner's own scope.

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

  const out: Record<string, unknown> = {};
  // Set on the first per-user failure. A caught failure must still surface as
  // a non-2xx response: both the GitHub workflow and the Cloudflare Worker in
  // cron-worker/ key off the HTTP status, not the body, and that signal was
  // deliberately restored once already (see with-session.ts's
  // withCronFanOut, which this route predates and does not use directly —
  // see the file comment on why this route's shape doesn't fit one uniform
  // per-user handler).
  let anyUserFailed = false;

  try {
    // Give permanently-failed jobs another chance, up to RETRY_CAP attempts
    // (covers both gcal and garmin targets). Cross-user by nature (see file
    // comment above) — left unscoped, not converted to a fan-out.
    const RETRY_CAP = 10;
    const requeued = await db
      .update(syncOutbox)
      .set({ status: "pending" })
      .where(and(eq(syncOutbox.status, "failed"), lt(syncOutbox.attempts, RETRY_CAP)))
      .returning({ id: syncOutbox.id });
    out.requeued = requeued.length;
  } catch (err) {
    console.error("GCal cron requeue error:", err);
    out.requeuedError = "requeue failed";
  }

  try {
    // "Is a calendar connected" is now a per-person fact, checked inside each
    // user's own scope, so the gate asks whether ANYONE is connected. The
    // drain itself stays cross-user on purpose — see the file comment.
    const connectedResults = await forEachUser(async (_tx, userId) => {
      try {
        return await isConnected(userId);
      } catch (err) {
        console.error(`Connection check failed for user ${userId}:`, err);
        return false;
      }
    });
    const anyConnected = connectedResults.some((r) => r.result);
    out.gcal = anyConnected ? await processGCalOutbox() : "not connected";
  } catch (err) {
    console.error("GCal cron error:", err);
    out.gcalError = "failed";
  }

  try {
    // Garmin is reached through installation-level worker credentials rather
    // than per-user OAuth, so in practice only the owner has a watch. The
    // toggle is still checked per user (it is per-user state), but only the
    // OWNER's iteration actually resyncs/queues — see the file comment and
    // sync/reconcile-garmin, whose shape this copies.
    const enabledResults = await forEachUser(async (_tx, userId) => {
      try {
        return await isGarminWorkoutSyncEnabled(userId);
      } catch (err) {
        console.error(`Garmin toggle check failed for user ${userId}:`, err);
        return false;
      }
    });
    const enabled = enabledResults.filter((r) => r.result).map((r) => r.userId);

    if (enabled.length > 0) {
      let repushed = 0;
      let queued = 0;
      let strengthQueued = 0;
      let skippedNonOwner = 0;

      for (const userId of enabled) {
        if (userId !== OWNER_USER_ID) {
          // A non-owner's toggle being on means nothing to push to, since only
          // the owner's rows can ever carry a garminWorkoutId (see file
          // comment). Skipped rather than fanned out over, same as
          // sync/reconcile-garmin.
          skippedNonOwner++;
          continue;
        }
        try {
          await withUser(asUserId(userId), async () => {
            // Self-heal first: anything we pushed that has vanished from
            // Garmin gets recreated, then the window rolls forward as usual.
            const resync = await resyncGarminWindow(userId);
            repushed += resync.repushed;
            queued += await queueGarminWindowSync(userId);
            // Kraft sessions ride the same rolling window as runs.
            strengthQueued += await queueGarminStrengthWindowSync(userId);
          });
        } catch (err) {
          // Per user, so one athlete's Garmin outage cannot skip everyone
          // queued behind them.
          console.error(`Garmin window sync failed for user ${userId}:`, err);
          anyUserFailed = true;
        }
      }

      out.garminResync = repushed;
      out.garminQueued = queued;
      out.garminStrengthQueued = strengthQueued;
      if (skippedNonOwner > 0) out.garminSkippedNonOwner = skippedNonOwner;
      // Cross-user by nature (see file comment) — left unscoped.
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
    // reached the watch. Per user because pruneStaleAdhocSessions filters by
    // ownedBy(strengthSessions), i.e. currentUserId() — see
    // lib/strength/schedule.ts.
    const results = await forEachUser(async (_tx, userId) => {
      try {
        return await pruneStaleAdhocSessions();
      } catch (err) {
        console.error(`Stale ad-hoc strength session prune failed for user ${userId}:`, err);
        anyUserFailed = true;
        return { removed: 0 };
      }
    });
    out.strengthAdhocPruned = results.reduce((sum, r) => sum + r.result.removed, 0);
  } catch (err) {
    console.error("Stale ad-hoc strength session prune error:", err);
    out.strengthAdhocPruneError = "prune failed";
  }

  try {
    // Backstop only — the real path is the 15-minute sync-drain cron (see
    // that route). Cheap and idempotent, so calling it again here is harmless
    // on a normal day and catches abandoned sessions if that faster cron is
    // ever broken end to end (same reasoning as dispatchDueReminders below).
    // Per user for the same reason as the prune above.
    const results = await forEachUser(async (_tx, userId) => {
      try {
        return await autoCloseAbandonedSessions();
      } catch (err) {
        console.error(`Strength auto-close failed for user ${userId}:`, err);
        anyUserFailed = true;
        return { closed: 0 };
      }
    });
    out.strengthAutoClosed = results.reduce((sum, r) => sum + r.result.closed, 0);
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
      const results = await forEachUser(async (_tx, userId) => {
        try {
          return await runGarminImport(asUserId(userId));
        } catch (err) {
          console.error(`Garmin import failed for user ${userId}:`, err);
          anyUserFailed = true;
          return "failed" as const;
        }
      });
      const imports: Record<string, unknown> = {};
      for (const r of results) imports[r.userId] = r.result;
      out.garminImport = imports;
    }
  } catch (err) {
    console.error("Garmin cron import error:", err);
    out.garminImportError = "import failed";
  }

  try {
    const results = await forEachUser(async (_tx, userId) => {
      try {
        return await runWellnessSync(asUserId(userId));
      } catch (err) {
        console.error(`Wellness sync failed for user ${userId}:`, err);
        anyUserFailed = true;
        return "failed" as const;
      }
    });
    const wellness: Record<string, unknown> = {};
    for (const r of results) wellness[r.userId] = r.result;
    out.wellnessSync = wellness;
  } catch (err) {
    console.error("Garmin wellness sync error:", err);
    out.wellnessSyncError = "sync failed";
  }

  try {
    // Per user: dispatchDueReminders reads reminder_settings/sent_reminders,
    // both tenanted (see lib/reminders/dispatch.ts). The frequent 15-minute
    // dispatch already fans out via withCronFanOut (see cron/reminders); this
    // is just the once-a-day backstop, same reasoning as the strength
    // auto-close above.
    const results = await forEachUser(async (_tx, userId) => {
      try {
        return await dispatchDueReminders();
      } catch (err) {
        console.error(`Reminder dispatch failed for user ${userId}:`, err);
        anyUserFailed = true;
        return { ok: false as const };
      }
    });
    out.reminders = Object.fromEntries(results.map((r) => [r.userId, r.result]));
  } catch (err) {
    console.error("Reminder dispatch error:", err);
    out.remindersError = "dispatch failed";
  }

  const hasBlockError = Object.keys(out).some((k) => k.endsWith("Error"));
  out.ok = !anyUserFailed && !hasBlockError;
  return Response.json(out, { status: out.ok ? 200 : 500 });
}
