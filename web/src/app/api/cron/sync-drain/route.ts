import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { drainOutboxNow } from "@/lib/sync/outbox-drain";

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

  try {
    await drainOutboxNow();
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Sync drain cron error:", err);
    return Response.json({ ok: false, error: "drain failed" }, { status: 500 });
  }
}
