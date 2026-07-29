import { sql } from "drizzle-orm";
import { db } from "./index";
import { users } from "./schema";
import { txStore } from "./tx-store";

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
// The app talks to Neon through a TRANSACTION pooler, and db/index.ts caps the
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
// ── Why set_config and not a SET LOCAL string ────────────────────────────────
//
// Postgres does not accept a bind parameter in `SET LOCAL app.user_id = $1`,
// so writing it that way forces the user id to be interpolated into SQL text.
// `set_config()` is an ordinary function call and takes a real parameter, so
// the id is bound, never concatenated. The assertion below is a second layer:
// even a bound value should not reach the database unless it is a uuid.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  userId: string,
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

  return db.transaction(async (tx) => {
    // Third argument true => transaction-scoped. See the note above; this
    // single boolean is what stops the value outliving the request.
    await tx.execute(
      sql`SELECT set_config('app.user_id', ${userId.toLowerCase()}, true)`
    );
    // Publish the transaction for the duration of `fn` so that plain `db`
    // usage underneath it runs here, on the connection that carries the
    // context, rather than on a pooled connection that does not.
    return txStore.run(tx, () => fn(tx));
  });
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
 */
export async function forEachUser<T>(
  fn: (tx: UserScopedDb, userId: string) => Promise<T>
): Promise<Array<{ userId: string; result: T }>> {
  // The users table is identity, not tenanted data, so it carries no policy
  // and this read is intentionally global. It is the only global read in the
  // request path, and it returns ids, never anyone's training data.
  const allUsers = await db.select({ id: users.id }).from(users);

  const out: Array<{ userId: string; result: T }> = [];
  for (const { id } of allUsers) {
    out.push({ userId: id, result: await withUser(id, (tx) => fn(tx, id)) });
  }
  return out;
}
