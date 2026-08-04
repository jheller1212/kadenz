// ── Bounding a cron's wall-clock cost ───────────────────────────────────────
//
// A cron that fans out over every user, once per user opening a database
// transaction and then making outbound HTTP calls (Garmin, Google Calendar,
// web push) inside it, is O(users × external round trips) with no cap. The
// database client is capped at ONE physical connection per function instance
// (db/index.ts), so that entire chain runs on the single connection this
// invocation was given — nothing else on the instance can use it until the
// loop finishes.
//
// As the user count (or one user's backlog) grows, that loop can take longer
// than Vercel's function timeout. When it does, the platform kills the
// process outright rather than letting the loop return — there is no chance
// to COMMIT/ROLLBACK the open transaction or hand the connection back
// cleanly, and the next invocation can spend real time waiting/retrying
// before it gets a usable connection of its own.
//
// A budget turns "run until killed" into "run until a deadline safely inside
// the platform limit, then stop and let the next scheduled tick continue".
// Every cron this guards runs every 15 minutes (see the GitHub Actions
// workflows and cron-worker/), and every operation it guards is idempotent
// (claim-before-send, `FOR UPDATE SKIP LOCKED`, or a plain re-check of
// current state) — a truncated run is not a missed run, it is a slower one.

export interface CronBudget {
  /** True once the budget has been spent; stop starting new work. */
  exceeded(): boolean;
  /** Milliseconds elapsed since the budget was created. */
  elapsedMs(): number;
}

/**
 * A wall-clock budget in milliseconds, safely under the platform's hard
 * timeout. Callers check `exceeded()` BETWEEN units of work (e.g. between
 * users in a fan-out), never mid-unit — this cannot cancel work already in
 * flight, it only stops new work from starting.
 */
export function createCronBudget(budgetMs: number): CronBudget {
  const start = Date.now();
  return {
    exceeded: () => Date.now() - start > budgetMs,
    elapsedMs: () => Date.now() - start,
  };
}
