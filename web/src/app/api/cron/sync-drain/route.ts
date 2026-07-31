import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { drainOutboxNow } from "@/lib/sync/outbox-drain";
import { autoCloseAbandonedSessions } from "@/lib/strength/schedule";
import { listAllUserIds } from "@/lib/users";

// ── GET /api/cron/sync-drain ────────────────────────────────────────────────
// Safety net for outbox delivery. A plan create/edit/delete already triggers
// its own drain via after() (see outbox-drain.ts) the moment it happens, so
// this route isn't the primary delivery path — but after() depends on the
// serverless platform actually honouring the extended lifetime, and an
// invocation can still be killed by a hard timeout or a bad deploy mid-flight.
// Without something re-checking the outbox between plan changes, a drain that
// didn't make it would sit until the once-daily /api/cron/gcal run, which is
// exactly the multi-day staleness this whole feature exists to prevent.
//
// Runs every 15 minutes via .github/workflows/sync-drain.yml, same reasoning
// as reminders.yml: Vercel Hobby allows exactly one cron job and that slot is
// spent on /api/cron/gcal, but the repo is public so GitHub Actions minutes
// are free. Deliberately narrow — outbox drain only, no window roll-forward,
// no resync repair, no activity import — so a 15-minute cadence stays cheap.
//
// Safe to call concurrently with itself, with a plan change's own drain, and
// with the daily cron: claimJobs() in sync-manager.ts claims outbox rows with
// `FOR UPDATE SKIP LOCKED`, so overlapping drains can never process the same
// row twice.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = { ok: true };

  // A cron run carries no session, so it has no single user to act as. Both
  // drainOutboxNow's queueing decisions (is watch sync on, is a calendar
  // connected) and, as of the outbox reshape, the drains themselves are per
  // person now — one transaction can only carry one app.user_id, so each
  // user's claim is scoped to their own rows (see processGCalOutbox /
  // processGarminOutbox in sync-manager.ts / garmin-sync.ts).
  //
  // One user's failure must not stop the ones queued behind them, hence the
  // catch inside the loop rather than around it — but it must still flip the
  // overall response to a non-2xx, since both the GitHub workflow and the
  // Cloudflare Worker in cron-worker/ key off the HTTP status. Superseded by
  // withCronFanOut once phase 3 lands; see listAllUserIds in lib/users.ts.
  try {
    const userIds = await listAllUserIds();
    let drained = 0;
    let anyUserFailed = false;
    for (const userId of userIds) {
      try {
        const { ok } = await drainOutboxNow(userId);
        if (ok) drained++;
        else anyUserFailed = true;
      } catch (err) {
        console.error(`Sync drain failed for user ${userId}:`, err);
        anyUserFailed = true;
      }
    }
    out.drain = { users: userIds.length, drained };
    if (anyUserFailed) {
      out.drainError = "some users failed";
      out.ok = false;
    }
  } catch (err) {
    console.error("Sync drain cron error:", err);
    out.ok = false;
    out.drainError = "drain failed";
  }

  try {
    // Rides this same 15-minute cadence so an abandoned Kraft session closes
    // within roughly 30-45 minutes of going idle rather than waiting for the
    // once-daily gcal cron — see lib/strength/schedule.ts autoCloseAbandonedSessions.
    out.strengthAutoClosed = await autoCloseAbandonedSessions();
  } catch (err) {
    console.error("Strength auto-close cron error:", err);
    out.strengthAutoCloseError = "auto-close failed";
  }

  return Response.json(out, { status: out.ok ? 200 : 500 });
}
