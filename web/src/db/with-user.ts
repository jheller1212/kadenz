import { sql } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { txStore } from "./tx-store";
import { asUserId, type UserId } from "@/lib/user-id";

// ── The per-request database context ─────────────────────────────────────────
//
// This file is the whole safety model for multi-user Kadenz. Row level
// security (drizzle/0053_rls.sql) decides which rows a query may see by
// comparing each row's user_id against the `app.user_id` setting on the
// connection. Something has to put the right value there for every request,
// exactly once, and take it away again afterwards. That is withUser.
//
// ── Why it cannot leak across pooled connections ─────────────────────────────
//
// The app talks to Supabase through a TRANSACTION pooler, and db/index.ts caps the
// client at one connection per function instance. Both facts mean a physical
// connection is handed to one request, returned, and handed to a different
// request afterwards. Anything left behind on that connection is inherited by
// whoever gets it next.
//
// A bare `SET app.user_id = ...` is session-scoped: it survives until the
// connection is closed or the value is overwritten. Under a pooler, that is a
// cross-user data leak with no bug at the call site. Request A sets its id,
// finishes, and request B reuses the connection and reads A's data because
// nothing reset the setting.
//
// The fix is that the setting is never session-scoped here. Three properties,
// together, are what make it safe:
//
//   1. `db.transaction(...)` opens an explicit BEGIN before anything else runs,
//      so there is always a transaction in progress to scope the setting to.
//   2. `set_config(..., true)` is the function form of SET LOCAL. The third
//      argument, `is_local`, is what makes the value transaction-scoped:
//      Postgres reverts it on COMMIT and on ROLLBACK alike. There is no path
//      out of `fn` (return, throw, or a caller that never awaits) that leaves
//      the value set, because the transaction ends either way.
//   3. Every query inside `fn` runs on `tx`, the same connection the BEGIN was
//      issued on. That is not left to the call site to remember: the
//      transaction is published on an AsyncLocalStorage store below, and the
//      `db` proxy in db/index.ts reads it, so an ordinary `db.select(...)`
//      anywhere beneath `withUser` -- including several helpers deep in
//      src/lib -- is transparently routed onto this transaction.
//
//      AsyncLocalStorage is what makes that safe rather than merely
//      convenient. The store is entered per call and propagates down the
//      await chain of that call only, so two requests running concurrently in
//      the same process each see their own transaction. It is not a global
//      variable, which would have exactly the cross-request bleed this whole
//      file exists to prevent.
//
//      Outside any withUser call the proxy falls back to the pooled client,
//      which has no context set and which RLS therefore shows nothing. So the
//      failure mode of forgetting to wrap a route is an empty response, not a
//      leaked one.
//
// So the setting's lifetime is exactly the transaction's lifetime, and the
// transaction's lifetime is strictly inside one request. The pooler can only
// hand out the connection once the transaction has ended, and by then the
// value is already gone. There is no window in which a second request can
// observe the first request's context.
//
// ── What this costs, and the one rule it imposes on call sites ───────────────
//
// A transaction-scoped setting means a transaction is open for as long as the
// callback runs, and db/index.ts caps the client at one connection per function
// instance. For a handful of queries that is microseconds and invisible. For a
// callback that awaits a third party it is not: the transaction, and the
// instance's only connection, are held for the whole round trip, which turns a
// slow external API into a database problem and risks an idle-in-transaction
// timeout.
//
// So the rule is: keep external HTTP calls out of the callback when there are
// more than a couple of them. Read inside withUser, call the third party
// outside it, write inside a second withUser. The atomicity that appears to
// give up was never real anyway, because no COMMIT or ROLLBACK can undo a
// request already sent to Garmin or Strava.
//
// ── Why set_config and not a SET LOCAL string ────────────────────────────────
//
// Postgres does not accept a bind parameter in `SET LOCAL app.user_id = $1`,
// so writing it that way forces the user id to be interpolated into SQL text.
// `set_config()` is an ordinary function call and takes a real parameter, so
// the id is bound, never concatenated. The assertion below is a second layer:
// even a bound value should not reach the database unless it is a uuid.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A user id is a branded type, not a string. The reasoning, and the one
// validating entry point (asUserId), live in lib/user-id.ts, which imports
// nothing so that the Edge-runtime proxy can reach it too. Re-exported here
// because this file is where callers already come for identity.
export type { UserId } from "@/lib/user-id";
export { asUserId } from "@/lib/user-id";

/**
 * The database handle passed to a `withUser` callback. It is a transaction,
 * not the pooled client, and it is the only handle inside the callback that
 * carries the caller's identity.
 */
export type UserScopedDb = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];


/**
 * Runs `fn` inside a transaction whose row level security context is `userId`.
 *
 * Every request that touches tenanted data goes through this. Queries made on
 * the handle it provides see that user's rows and no one else's, enforced by
 * the database rather than by remembering to write a WHERE clause.
 *
 * Call sites should still filter by user_id themselves where it is natural:
 * it keeps the intent readable and lets the planner use the per-table
 * user_id indexes. RLS is the guarantee, the filters are the optimisation.
 */
export async function withUser<T>(
  userId: UserId,
  fn: (tx: UserScopedDb) => Promise<T>
): Promise<T> {
  // A non-uuid here means a caller invented an identity instead of taking one
  // from getSessionUserId. Refuse loudly rather than setting a context that no
  // policy can match, which would look like "this user has no data".
  if (!UUID_RE.test(userId)) {
    throw new Error(
      `withUser requires a uuid user id, received ${JSON.stringify(userId)}`
    );
  }
  const normalizedUserId = userId.toLowerCase();

  // ── Reentrant call, same user: join the transaction already open ──────────
  //
  // db/index.ts caps the client at ONE physical connection per function
  // instance (`max: 1`). A caller already inside a withUser scope that calls
  // withUser again (e.g. a plan mutation's after() callback re-entering
  // withUser to restore RLS context, then calling drainOutboxNow(), which
  // calls processGarminOutbox()/processGCalOutbox() — both of which call
  // withUser themselves, unconditionally, so they also work when invoked
  // standalone from a cron fan-out) would, if this fell through to
  // `db.transaction(...)` below, ask the *same* single connection to open a
  // second, nested transaction while the first is still in progress.
  //
  // That is not a savepoint (nothing here calls tx.transaction()) — it is the
  // pooled client's own top-level `.transaction()`, on a connection the outer
  // call has reserved for the whole callback's duration. With max: 1 there is
  // no second connection to hand the inner call, so it either queues behind
  // the outer transaction (a self-deadlock: the outer callback cannot return,
  // and therefore cannot free the connection, until the inner call it is
  // awaiting resolves) or, once a request finally times out and the instance
  // is reused warm with the same wedged, still-open transaction on its one
  // connection, the next request's BEGIN lands on a session that never
  // committed — exactly the `WARNING: there is already a transaction in
  // progress` observed in production, and the idle-in-transaction connection
  // sitting on ClientRead until something reclaims it.
  //
  // The fix is not to prevent nesting (the call sites above are legitimate:
  // drainOutboxNow must work both nested-under-an-after()-callback and called
  // directly from the cron fan-out, which has no outer transaction) but to
  // make it safe: if the store already holds a transaction, and it is scoped
  // to the SAME user this call asks for, run `fn` on that transaction instead
  // of opening another one. No second BEGIN, no second connection request, no
  // divergence in RLS context — this is the caller's own already-verified
  // identity, not a different user borrowing it. Nesting for a DIFFERENT user
  // is refused below rather than silently mixed.
  const existing = txStore.getStore();
  if (existing) {
    if (existing.userId !== normalizedUserId) {
      throw new Error(
        `withUser(${normalizedUserId}) called while already scoped to ${existing.userId} on the same connection — nesting withUser for a different user is not supported (see db/with-user.ts).`
      );
    }
    return fn(existing.tx as UserScopedDb);
  }

  // Always open on the POOLED client, never on an inherited transaction.
  //
  // `db` is a proxy that resolves to whatever transaction the current store
  // holds, which is exactly what makes plain `db` calls inside `fn` land on the
  // right connection. Here it is wrong twice over, so the store is exited first:
  //
  //   1. Work registered with Next's after() runs once the response has been
  //      sent, and the store can still be readable there while the transaction
  //      it names has already COMMITTED. Opening on that handle issues a
  //      SAVEPOINT against a finished transaction, which fails with "SAVEPOINT
  //      can only be used in transaction blocks". Observed, not theorised: it is
  //      what the e2e suite reported before this line existed.
  //   2. A withUser nested inside another withUser for the SAME user is handled
  //      above, before this point is ever reached. For a DIFFERENT user it is
  //      refused above. Either way `db.transaction(...)` below never runs with
  //      a stale store still attached, so it always opens a genuinely fresh
  //      transaction on the pooled client, not a savepoint on someone else's.
  //
  // Exiting the store means every fresh withUser gets its own transaction with
  // its own context and its own lifetime, which is the only version of this
  // that is safe to call from anywhere.
  return txStore.exit(() =>
    db.transaction(async (tx) => {
      // Third argument true => transaction-scoped. See the note above; this
      // single boolean is what stops the value outliving the request.
      await tx.execute(
        sql`SELECT set_config('app.user_id', ${normalizedUserId}, true)`
      );
      // Publish the transaction for the duration of `fn` so that plain `db`
      // usage underneath it runs here, on the connection that carries the
      // context, rather than on a pooled connection that does not.
      return txStore.run({ tx, userId: normalizedUserId }, () => fn(tx));
    })
  );
}

/**
 * The id of the user the current request belongs to.
 *
 * Throws outside a `withUser` call. That is the point: a query that needs to
 * name its owner must not be able to fall back to a guess, and a route that
 * forgot to wrap itself should fail on the first line rather than quietly read
 * an empty database. The thrown error is turned into a 500 by the route
 * wrapper, which is loud, which is what an unwrapped route deserves.
 */
export function currentUserId(): UserId {
  const userId = txStore.getStore()?.userId;
  if (!userId) {
    throw new Error(
      "currentUserId() called outside a request context. Wrap the route in withSession() (src/lib/api/with-session.ts) or the job in withUser()/forEachUser()."
    );
  }
  return userId as UserId;
}

/** The current user id, or null outside a request context. */
export function currentUserIdOrNull(): UserId | null {
  return (txStore.getStore()?.userId as UserId | undefined) ?? null;
}

/**
 * Runs `fn` once per user, each inside that user's own context.
 *
 * Background work (reminders, the sync drain, the wellness pull) was written
 * when there was one athlete and simply read whole tables. Under RLS such a
 * query returns nothing, because no context is set. This is the honest
 * replacement: fan out over users and do the same work inside each one's
 * context, rather than granting the job a way to see everyone at once.
 *
 * It is deliberately a loop. That is the correct shape for the tens of users
 * the invite-only beta targets, and the plan already flags that it needs a
 * queue long before it reaches thousands.
 *
 * It fans out over EVERY user, which is right for work every athlete needs
 * (reminders, the outbox drain) and wasteful for work that depends on an
 * integration only some of them have connected. The extension point for that is
 * an optional predicate here, narrowing the user list, NOT a second fan-out
 * helper somewhere else: two ways to iterate users is precisely the
 * one-concept-implemented-twice shape this codebase produces most often. It is
 * not added yet because per-user credentials do not exist yet, and a filter
 * written against a table that has not landed would be a guess.
 */
export async function forEachUser<T>(
  fn: (tx: UserScopedDb, userId: UserId) => Promise<T>
): Promise<Array<{ userId: UserId; result: T }>> {
  // The users table is identity, not tenanted data, so it carries no policy
  // and this read is intentionally global. It is the only global read in the
  // request path, and it returns ids, never anyone's training data.
  const allUsers = await db.select({ id: users.id }).from(users);

  const out: Array<{ userId: UserId; result: T }> = [];
  for (const { id } of allUsers) {
    // The users table stores a plain uuid column, so this is the boundary where
    // a raw string becomes a UserId. Validated, not cast.
    const userId = asUserId(id);
    out.push({ userId, result: await withUser(userId, (tx) => fn(tx, userId)) });
  }
  return out;
}
