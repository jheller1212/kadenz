import type { NextRequest } from "next/server";
import { resolveRequestUserId } from "@/lib/request-user";
import { forEachUser, withUser } from "@/db/with-user";
import { HttpError } from "./errors";
import { listAllUserIds } from "@/lib/users";
import { asUserId } from "@/lib/user-id";
import { createCronBudget } from "@/lib/cron/budget";

// ── The one way an API route gets a database ──────────────────────────────────
//
// A route under /api has already passed src/proxy.ts, which proves the caller
// holds a valid session cookie. It does NOT say whose. That distinction is the
// whole of the phase 3 leak audit: thirty-seven routes answered a signed-in
// caller with another athlete's rows, because "authenticated" was as far as the
// question went.
//
// withSession closes that by construction. It reads the user id out of the
// signed cookie, opens the request's database transaction with that user's row
// level security context (see db/with-user.ts), and runs the handler inside it.
// Every `db` query the handler makes -- directly or through any helper in
// src/lib -- lands on that transaction, so the database itself refuses rows
// belonging to anyone else.
//
// It is a wrapper rather than a line to copy into each handler because the
// failure mode of the copied line is silence. A route that forgets it reads on
// the pooled connection, which has no context, which under FORCE row level
// security returns zero rows: an empty screen, no error, nothing in the logs.
// A route that forgets the wrapper is caught by the leak test
// (e2e/specs/cross-user-isolation.spec.ts), which enumerates the route files on
// disk and fails on any it does not recognise.

/** The context Next passes as the second argument to a route handler. */
export type RouteContext<P = Record<string, never>> = { params: Promise<P> };

export type SessionHandler<C> = (
  request: NextRequest,
  context: C
) => Promise<Response>;

/**
 * Converts a thrown HttpError into its response, and anything else into a 500.
 *
 * Ownership failures are thrown rather than returned so that a helper several
 * calls deep (requireOwned in api/owned.ts) can refuse without every caller in
 * between having to notice and forward the refusal.
 */
function toResponse(err: unknown, label: string): Response {
  if (err instanceof HttpError) {
    return Response.json(err.payload, { status: err.status });
  }
  console.error(`[${label}] request failed:`, err);
  return Response.json({ error: "Internal error" }, { status: 500 });
}

/**
 * Wraps a route handler so it runs as, and can only see the data of, the user
 * who owns the request's session cookie.
 */
export function withSession<C>(handler: SessionHandler<C>): SessionHandler<C> {
  return async (request, context) => {
    // resolveRequestUserId, not the cookie directly: a request can also carry
    // the native shell's bearer token, and identity must have ONE resolver or
    // the shell ends up with a second notion of who is calling that can drift
    // from the browser's. lib/request-user.ts owns which credential was
    // presented; this file owns what happens once that is known.
    const userId = await resolveRequestUserId(request);
    if (!userId) {
      // The proxy normally rejects these first. This is the same answer, for
      // the cases it does not cover: a cookie in the pre-identity format, and
      // any future caller that reaches a handler without passing the proxy.
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      return await withUser(userId, () => handler(request, context));
    } catch (err) {
      return toResponse(err, new URL(request.url).pathname);
    }
  };
}

/**
 * Wraps a background route: one that Vercel cron calls with a bearer token, and
 * that the owner may also trigger from a signed-in session.
 *
 * Called with the bearer token it fans out over every user, running `handler`
 * once inside each one's context. Called with a session cookie it runs once, as
 * that user. Both paths run the same handler, so a manual run and a scheduled
 * run cannot drift apart.
 *
 * Fanning out is the honest shape for work that used to read whole tables. The
 * alternative -- giving the job a context that sees everyone -- would mean one
 * connection on which row level security is off, reachable from a route, which
 * is the thing phase 3 exists to remove.
 *
 * ── The handler contract, and why the status code is aggregated ───────────────
 *
 * A handler must catch its own errors and report a failure as `{ ok: false }`
 * in its returned object, because an uncaught throw inside forEachUser aborts
 * the sweep and silently skips every user queued behind it. One athlete's
 * Garmin outage must not stop everyone else's reminders.
 *
 * But catching per user is not enough on its own. Before the fan-out existed,
 * /api/cron/sync-drain answered a drain failure with a 500, and BOTH callers
 * key off the HTTP status rather than the body: .github/workflows/sync-drain.yml
 * fails the job outside 2xx, and the Cloudflare Worker in cron-worker/ re-throws
 * on a non-2xx instead of logging. The Worker exists precisely because a
 * previous scheduler failed silently for weeks with nobody noticing.
 *
 * So a caught per-user failure that still returned 200 would put the failure
 * only in the response body, which nothing reads, and sync failures would go
 * back to being invisible. That is the exact condition the Worker was built to
 * end. Hence: every user's iteration runs to completion, and THEN the status is
 * aggregated. All succeeded is a 200, any failed is a 500 with the per-user
 * detail still in the body. A partial failure is a failure for monitoring
 * purposes.
 *
 * Do not "simplify" this back to a uniform 200. The workflow and the Worker
 * both depend on the status code.
 *
 * ── budgetMs: bounding the fan-out ─────────────────────────────────────────
 *
 * `forEachUser` iterates every user strictly sequentially, each iteration
 * opening its own transaction on the instance's single pooled connection
 * (db/index.ts: `max: 1`). For a handler whose body is a couple of local
 * queries that is invisible. For a handler that also makes outbound HTTP
 * calls per user (Garmin, Google Calendar, web push) it is not: the
 * connection is held for the whole sequential chain, and as the user count
 * (or one user's backlog) grows this is an unbounded way to spend a hard
 * platform timeout — Vercel kills the function outright at the limit, which
 * does not give the open transaction a chance to release the connection
 * cleanly, and the next invocation can pay for that.
 *
 * Passing `budgetMs` switches the cron path from `forEachUser` to a hand-
 * rolled loop over `listAllUserIds()` that checks a wall-clock budget
 * between users (never mid-user) and stops starting new ones once it is
 * spent, marking the response `truncated: true`. That is safe specifically
 * because every handler this guards is idempotent and re-runs on the next
 * scheduled tick (15 minutes later) — a truncated run is a slower run, not a
 * missed one. Omit `budgetMs` to keep the existing unbounded `forEachUser`
 * behaviour for callers (the on-demand reconcile routes) that are not on a
 * tight, frequent schedule.
 */
export function withCronFanOut(
  handler: (userId: string) => Promise<Record<string, unknown>>,
  label: string,
  options?: { budgetMs?: number }
): (request: NextRequest) => Promise<Response> {
  return async (request) => {
    const secret = process.env.CRON_SECRET;
    const fromCron =
      Boolean(secret) &&
      request.headers.get("authorization") === `Bearer ${secret}`;

    try {
      if (fromCron) {
        const budgetMs = options?.budgetMs;
        let entries: Array<Record<string, unknown>>;
        let truncated = false;

        if (budgetMs != null) {
          const budget = createCronBudget(budgetMs);
          const allUserIds = await listAllUserIds();
          entries = [];
          for (const rawUserId of allUserIds) {
            if (budget.exceeded()) {
              truncated = true;
              break;
            }
            const userId = asUserId(rawUserId);
            const result = await withUser(userId, () => handler(userId));
            entries.push({ userId, ...result });
          }
        } else {
          const results = await forEachUser(async (_tx, userId) => handler(userId));
          entries = results.map((r) => ({ userId: r.userId, ...r.result }));
        }

        // Explicitly `=== false`, not falsy: a handler that reports neither
        // (a skipped iteration, say) is not a failure, and treating a missing
        // `ok` as one would turn every no-op sweep into a paging 500.
        const failed = entries.filter((e) => e.ok === false);
        return Response.json(
          {
            ok: failed.length === 0,
            users: entries.length,
            failed: failed.length,
            results: entries,
            ...(truncated ? { truncated: true } : {}),
          },
          { status: failed.length === 0 ? 200 : 500 }
        );
      }

      const userId = await resolveRequestUserId(request);
      if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      const result = await withUser(userId, () => handler(userId));
      const failed = result.ok === false;
      return Response.json(
        {
          ok: !failed,
          users: 1,
          failed: failed ? 1 : 0,
          results: [{ userId, ...result }],
        },
        { status: failed ? 500 : 200 }
      );
    } catch (err) {
      return toResponse(err, label);
    }
  };
}
