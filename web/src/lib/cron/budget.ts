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
  /** Milliseconds left before the deadline; 0 once spent. */
  remainingMs(): number;
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
    remainingMs: () => Math.max(0, budgetMs - (Date.now() - start)),
  };
}

/**
 * Run ONE unit of work, giving up if the budget runs out before it returns.
 *
 * Checking `exceeded()` between units bounds how many units start; it does
 * nothing about a single unit that never returns. With one user in the
 * database that is the whole loop, so the between-units check never fires
 * even once and the fan-out is effectively unbounded — which is how
 * /api/cron/sync-drain came to die on FUNCTION_INVOCATION_TIMEOUT at
 * Vercel's hard 300s ceiling while nominally carrying a 120s budget.
 *
 * The mechanism it guards against is a unit built from individually-bounded
 * parts that are unbounded in aggregate: the Garmin drain claims up to 50
 * jobs and allows each ~10s, so a worker that is merely unreachable costs
 * up to 500s without a single call misbehaving.
 *
 * Resolves `{ timedOut: true }` rather than throwing, because a truncated
 * pass is a normal outcome here, not an error: every operation this guards
 * is idempotent (claim-before-send, `FOR UPDATE SKIP LOCKED`), so whatever
 * was in flight is picked up by the next tick — rows left mid-flight are
 * recovered by resetStaleClaims.
 *
 * It does NOT cancel the abandoned work — nothing here can, since the
 * outbound calls own their own sockets. It stops that work from deciding
 * how long the invocation lives. The function returns its response; the
 * platform tears the instance down with it.
 */
export async function runWithinBudget<T>(
  budget: CronBudget,
  fn: () => Promise<T>
): Promise<{ timedOut: false; value: T } | { timedOut: true }> {
  const remaining = budget.remainingMs();
  if (remaining <= 0) return { timedOut: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), remaining);
  });

  try {
    return await Promise.race([
      fn().then((value) => ({ timedOut: false as const, value })),
      deadline,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
