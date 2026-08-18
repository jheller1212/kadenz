import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
import { drainOutboxNow } from "@/lib/sync/outbox-drain";
import { autoCloseAbandonedSessions } from "@/lib/strength/schedule";
import { listAllUserIds } from "@/lib/users";
import { withUser } from "@/db/with-user";
import { asUserId } from "@/lib/user-id";
import { createCronBudget, runWithinBudget } from "@/lib/cron/budget";

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
//
// ── Scope per user: the drain outside a transaction, auto-close inside ──────
// drainOutboxNow's queueing decisions (is watch sync on, is a calendar
// connected) and its drains are per person — one transaction can only carry
// one app.user_id (db/with-user.ts), so each user's claim is scoped to their
// own rows (processGCalOutbox / processGarminOutbox). The strength auto-close
// filters via ownedBy(strengthSessions), which reads currentUserId() off that
// same transaction-scoped context and THROWS outside it. It used to run once,
// globally, after this loop — with no context to throw against, so every
// call failed with "currentUserId() called outside a request context" and was
// swallowed by its own try/catch, logged as "Strength auto-close cron error"
// and nothing else. It has done that on every run since RLS started covering
// strengthSessions (#120, 30 Jul) — auto-close was never happening in
// production. Folding it into this same per-user withUser scope, alongside
// the drain, is the fix: both run with a real app.user_id set, and both are
// covered by the same per-user try/catch so one failing does not skip the
// other or the users queued behind them.
//
// What changed since: the drain is no longer inside that shared withUser.
// #173 moved the outbound calls out of the transaction so a slow third party
// can no longer hold this instance's single connection — but withUser is
// REENTRANT, so wrapping the drain here silently put every one of those calls
// back inside a transaction and undid it on this route, which runs every 15
// minutes rather than daily. The drain now scopes each of its own database
// steps; autoCloseAbandonedSessions still gets its own withUser because it is
// pure database work and reads currentUserId() off that context.
//
// ── Bounded, not unbounded ───────────────────────────────────────────────────
// Each user's drain can make many sequential outbound HTTP calls, and Vercel
// kills a function that runs past its hard 300s timeout. createCronBudget
// bounds the fan-out; a truncated pass reports `truncated: true` and finishes
// on the next 15-minute tick. Every operation here is idempotent
// (claim-before-send, `FOR UPDATE SKIP LOCKED`, or a plain re-check of
// session state), so a truncated run is a slower run, not a missed one.
//
// The budget alone was not enough, and this route is how that was found. It
// was checked only BETWEEN users, which bounds how many users start and
// nothing about how long one takes — and with a single user in the database
// the check ran once, at 0ms elapsed, and never again. Real runs then split
// two ways: 6-8 seconds when the watch worker answered, and exactly 300s
// (FUNCTION_INVOCATION_TIMEOUT) when it did not, because the Garmin drain
// claims up to 50 jobs and allows each ~10s — up to 500s of individually
// well-behaved calls. runWithinBudget bounds the single user's unit too, so
// the ceiling is the budget rather than the platform's kill.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = { ok: true };
  const budget = createCronBudget(120_000);

  try {
    const userIds = await listAllUserIds();
    let drained = 0;
    let closed = 0;
    let anyUserFailed = false;
    let anyAutoCloseFailed = false;
    let truncated = false;

    for (const rawUserId of userIds) {
      if (budget.exceeded()) {
        truncated = true;
        break;
      }
      const userId = asUserId(rawUserId);
      try {
        const outcome = await runWithinBudget(budget, async () => {
          let drainOk = true;
          try {
            // NOT inside withUser — see the note above. The drain opens its
            // own short transactions around each database step so its calls
            // to Google and the watch hold no connection.
            drainOk = (await drainOutboxNow(rawUserId)).ok;
          } catch (err) {
            console.error(`Sync drain failed for user ${rawUserId}:`, err);
            drainOk = false;
          }

          let closedCount = 0;
          let autoCloseFailed = false;
          try {
            // Pure database work, and it reads currentUserId() off the
            // transaction context — so it keeps its own scope.
            closedCount = (await withUser(userId, () => autoCloseAbandonedSessions())).closed;
          } catch (err) {
            console.error(`Strength auto-close failed for user ${rawUserId}:`, err);
            autoCloseFailed = true;
          }

          return { drainOk, closedCount, autoCloseFailed };
        });

        if (outcome.timedOut) {
          // The budget ran out inside this user's own work rather than
          // between users. Report it the same way as any other truncation:
          // everything here is idempotent, so the next tick resumes it.
          console.error(`Sync drain exceeded its budget for user ${rawUserId}`);
          truncated = true;
          anyUserFailed = true;
          break;
        }

        const result = outcome.value;
        if (result.drainOk) drained++;
        else anyUserFailed = true;
        closed += result.closedCount;
        if (result.autoCloseFailed) anyAutoCloseFailed = true;
      } catch (err) {
        console.error(`Sync drain failed for user ${rawUserId}:`, err);
        anyUserFailed = true;
        anyAutoCloseFailed = true;
      }
    }

    out.drain = { users: userIds.length, drained };
    out.strengthAutoClosed = { closed };
    if (truncated) out.truncated = true;
    if (anyUserFailed) {
      out.drainError = "some users failed";
      out.ok = false;
    }
    if (anyAutoCloseFailed) {
      out.strengthAutoCloseError = "auto-close failed for some users";
      out.ok = false;
    }
  } catch (err) {
    console.error("Sync drain cron error:", err);
    out.ok = false;
    out.drainError = "drain failed";
  }

  return Response.json(out, { status: out.ok ? 200 : 500 });
}
