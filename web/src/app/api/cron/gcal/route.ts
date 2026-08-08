import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { eq, and, lt } from "drizzle-orm";
import { db, syncOutbox, OWNER_USER_ID } from "@/db";
import { forEachUser, withUser } from "@/db/with-user";
import { processGCalOutbox, type SyncResult } from "@/lib/sync/sync-manager";
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
import {
  ensureStrengthSchedule,
  pruneStaleAdhocSessions,
  autoCloseAbandonedSessions,
} from "@/lib/strength/schedule";
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
// ── Per-user scope, everywhere, including the outbox drains ─────────────────
//
// Every read/write under FORCE row level security (drizzle/0053_rls.sql,
// 0066_rls_covers_every_tenanted_table.sql) needs an app.user_id set on the
// transaction it runs on, or it matches nothing (db/with-user.ts). A cron run
// carries no session, so there is no single user to act as, and everything
// this route does is genuinely per person: is THIS user's calendar connected,
// has THIS user turned on watch sync, prune THIS user's stale sessions,
// requeue THIS user's failed jobs, drain THIS user's outbox rows. All of it
// fans out over every user via forEachUser, each iteration running inside
// that user's own transaction.
//
// The two outbox drains and the failed-job requeue used to be left unscoped,
// on the reasoning that a single claim spanning every user's queued jobs
// can't be split across one-transaction-per-user without either claiming the
// same table N times or reinventing the claim inside a loop. That reasoning
// was backwards: claiming the table once per user IS the fix, not a problem
// to avoid — see processGCalOutbox / processGarminOutbox in
// sync-manager.ts / garmin-sync.ts, which now claim only the calling user's
// rows (explicit user_id filter, backed by RLS) and are looped here the same
// way every other per-person block in this route already is. Fairness (one
// user's backlog can no longer exhaust a shared claim cap meant for
// everyone) and the per-user claim's query cost are discussed at
// PER_USER_CLAIM_LIMIT in sync-manager.ts.
//
// Garmin is reached through one installation-level worker connection, not
// per-user OAuth (see garmin-config.ts), so only the owner's rows can ever
// legitimately carry a garminWorkoutId. The push/resync block below mirrors
// sync/reconcile-garmin's shape for that reason: it does not fan out the
// actual push over every enabled user, it runs once, for the owner, inside
// the owner's own scope. processGarminOutbox mirrors the same skip for
// non-owner iterations internally, so looping it over every user here is
// safe even though only the owner's iteration ever does real work.

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
    // (covers both gcal and garmin targets). Per user now, same as the
    // drains below — see file comment.
    const RETRY_CAP = 10;
    const requeueResults = await forEachUser(async (_tx, userId) => {
      try {
        const requeued = await db
          .update(syncOutbox)
          .set({ status: "pending" })
          .where(
            and(
              eq(syncOutbox.status, "failed"),
              lt(syncOutbox.attempts, RETRY_CAP),
              eq(syncOutbox.userId, userId)
            )
          )
          .returning({ id: syncOutbox.id });
        return requeued.length;
      } catch (err) {
        console.error(`Outbox requeue failed for user ${userId}:`, err);
        anyUserFailed = true;
        return 0;
      }
    });
    out.requeued = requeueResults.reduce((sum, r) => sum + r.result, 0);
  } catch (err) {
    console.error("GCal cron requeue error:", err);
    out.requeuedError = "requeue failed";
  }

  try {
    // Per user: is THIS person's calendar connected, and if so, drain THEIR
    // own pending rows (processGCalOutbox now claims only the calling user's
    // jobs — see its comment in sync-manager.ts). Aggregated into the same
    // SyncResult shape the route always reported, so nothing downstream of
    // this response needs to change.
    const gcalResults = await forEachUser(async (_tx, userId) => {
      try {
        if (!(await isConnected(userId))) return null;
        return await processGCalOutbox(asUserId(userId));
      } catch (err) {
        console.error(`GCal drain failed for user ${userId}:`, err);
        anyUserFailed = true;
        return null;
      }
    });
    const ran = gcalResults
      .map((r) => r.result)
      .filter((result): result is SyncResult => result !== null);
    out.gcal =
      ran.length > 0
        ? ran.reduce<SyncResult>(
            (sum, result) => ({
              processed: sum.processed + result.processed,
              succeeded: sum.succeeded + result.succeeded,
              failed: sum.failed + result.failed,
              errors: [...sum.errors, ...result.errors],
            }),
            { processed: 0, succeeded: 0, failed: 0, errors: [] }
          )
        : "not connected";
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
      // Scoped to the owner (processGarminOutbox skips any other caller
      // internally — see its comment in garmin-sync.ts).
      try {
        out.garmin = await processGarminOutbox(asUserId(OWNER_USER_ID));
      } catch (err) {
        console.error("Garmin outbox drain failed:", err);
        anyUserFailed = true;
        out.garminDrainError = "drain failed";
      }
    } else {
      out.garmin = "disabled";
    }
  } catch (err) {
    console.error("Garmin cron sync error:", err);
    out.garminError = "sync failed";
  }

  try {
    // ── Keep the strength schedule current ────────────────────────────────
    //
    // Tops up the next weeks of auto-scheduled sessions AND runs the weekly
    // Achilles/HSR rehab pass, which decides per calendar day whether a
    // session carries the rehab block or gets its own standalone Rehab day
    // (see lib/strength/schedule.ts and reconcile.ts
    // computeAchillesRehabDays).
    //
    // Until now the only caller was WeeklyStrengthPlan, which renders on
    // /plan and nowhere else, so the entire strength schedule was maintained
    // only when the athlete happened to open that one screen. An athlete who
    // lives on Today and Kraft — which is most of them, those being the
    // screens you use while actually training — got no maintenance at all.
    //
    // That is not a theoretical gap. It is why the owner had zero rehab
    // exposures for five days after #155 shipped: the pass was correct and
    // simply never ran. Rehab is the case that makes it serious, because it
    // is the work that exists precisely because something already hurts, but
    // the same silence applied to every top-up.
    //
    // ensureStrengthSchedule, not reconcileStrengthSchedule: reconcile prunes
    // before it tops up, and a scheduled job should not be deleting sessions
    // nobody asked it to touch. Ensure only adds what is missing and corrects
    // the rehab flag on future auto sessions the athlete has not started —
    // idempotent, so a normal day's run is a no-op.
    //
    // Per user, and per-user failures are contained: one athlete's bad
    // schedule state must not stop everyone else's from being maintained.
    const results = await forEachUser(async (_tx, userId) => {
      try {
        return await ensureStrengthSchedule(null, userId);
      } catch (err) {
        console.error(`Strength schedule top-up failed for user ${userId}:`, err);
        anyUserFailed = true;
        return { created: 0, shortWeeks: 0 };
      }
    });
    out.strengthSessionsCreated = results.reduce((sum, r) => sum + r.result.created, 0);
  } catch (err) {
    console.error("Strength schedule top-up error:", err);
    out.strengthScheduleError = "top-up failed";
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
