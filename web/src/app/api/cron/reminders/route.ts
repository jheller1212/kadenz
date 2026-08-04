import { withCronFanOut } from "@/lib/api/with-session";
import { dispatchDueReminders } from "@/lib/reminders/dispatch";

// ── GET /api/cron/reminders ─────────────────────────────────────────────────
// Workout push reminders need to be checked roughly every 15 minutes for the
// lead-time window to ever line up with a real send, but Vercel Hobby only
// allows one cron job and that slot is already spent on the once-daily
// GCal/Garmin sync (see /api/cron/gcal and vercel.json). Since the repo is
// public, GitHub Actions minutes are free, so the frequent schedule lives in
// .github/workflows/reminders.yml (and the Cloudflare Worker cron in
// cron-worker/) instead and hits this route directly. This handler does ONLY
// dispatchDueReminders — no Garmin calls, no calendar drain, no activity
// import — so calling it every 15 minutes is cheap.
//
// Reminder settings and sent_reminders are tenanted (Phase 3), so
// dispatchDueReminders needs a row level security context to see anything at
// all — withCronFanOut runs it once per user (bearer CRON_SECRET) or once for
// the caller (owner session), same auth as every other cron route. Reminders
// have no shared-device caveat the way Garmin does: every user's own push
// subscription is exactly that, their own.
//
// If the Vercel plan ever changes, this can move back into a Vercel cron
// (vercel.json) and the GitHub workflow can be deleted.
//
// Safe to call concurrently or repeatedly: dispatchDueReminders claims each
// workout via a unique DB constraint before sending, so overlapping or
// repeated invocations are no-ops, and a reminder never fires once the
// workout's start time has passed (see due.ts) — a cron outage does not
// produce a burst of stale reminders when it comes back.

export const GET = withCronFanOut(
  async (userId) => {
    // Caught locally, not left to withCronFanOut/forEachUser: those have no
    // per-user try/catch of their own, so an uncaught throw here would abort
    // the whole fan-out and drop every user queued behind this one instead of
    // just failing this one's dispatch.
    try {
      const result = await dispatchDueReminders();
      return { ok: true, reminders: result };
    } catch (err) {
      console.error(`Reminder dispatch error for user ${userId}:`, err);
      return { ok: false, error: "dispatch failed" };
    }
  },
  "cron-reminders",
  // Runs every 15 minutes (see the file comment) and each iteration can push
  // over the network per subscribed device, so this is bounded well inside
  // Vercel's function timeout rather than left to grow with the user count —
  // see the budgetMs note on withCronFanOut. A truncated run picks up the
  // remaining users on the next tick; dispatch is claim-before-send, so
  // nobody is double-reminded.
  { budgetMs: 120_000 }
);
