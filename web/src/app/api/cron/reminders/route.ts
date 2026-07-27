import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { dispatchDueReminders } from "@/lib/reminders/dispatch";

// ── GET /api/cron/reminders ─────────────────────────────────────────────────
// Workout push reminders need to be checked roughly every 15 minutes for the
// lead-time window to ever line up with a real send, but Vercel Hobby only
// allows one cron job and that slot is already spent on the once-daily
// GCal/Garmin sync (see /api/cron/gcal and vercel.json). Since the repo is
// public, GitHub Actions minutes are free, so the frequent schedule lives in
// .github/workflows/reminders.yml instead and hits this route directly.
// This handler does ONLY dispatchDueReminders — no Garmin calls, no calendar
// drain, no activity import — so calling it every 15 minutes is cheap.
//
// If the Vercel plan ever changes, this can move back into a Vercel cron
// (vercel.json) and the GitHub workflow can be deleted.
//
// Safe to call concurrently or repeatedly: dispatchDueReminders claims each
// workout via a unique DB constraint before sending, so overlapping or
// repeated invocations are no-ops, and a reminder never fires once the
// workout's start time has passed (see due.ts) — a cron outage does not
// produce a burst of stale reminders when it comes back.

export async function GET(request: NextRequest) {
  // Same auth as /api/cron/gcal: the cron secret (GitHub Actions here, or
  // Vercel's own scheduler if this ever moves back), or a signed-in session
  // so the owner can trigger a run by hand.
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchDueReminders();
    return Response.json({ ok: true, reminders: result });
  } catch (err) {
    console.error("Reminder dispatch error:", err);
    return Response.json({ ok: false, error: "dispatch failed" }, { status: 500 });
  }
}
