import { drizzle } from "drizzle-orm/postgres-js";
import { db, getClient } from "./index";
import * as schema from "./schema";
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
//   1. A hand-rolled `BEGIN` (sent on a connection reserved via
//      getClient().reserve(), together with the set_config call below -- see
//      "Why BEGIN and set_config share a round trip" further down) opens an
//      explicit transaction before anything else runs, so there is always one
//      in progress to scope the setting to.
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
// `set_config()` is an ordinary function call and normally takes a real bound
// parameter. Below it is folded into the same wire round trip as BEGIN (see
// "Why BEGIN and set_config share a round trip"), which Postgres's simple
// query protocol only allows for literal text, not bind parameters -- so the
// id IS interpolated there. That is safe only because it happens after the
// UUID_RE assertion a few lines down: by the time the string is built, it has
// already been proven to contain nothing but hex digits and dashes, so there
// is no SQL text an attacker could smuggle through it. Do not move this
// interpolation earlier than that check.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A user id is a branded type, not a string. The reasoning, and the one
// validating entry point (asUserId), live in lib/user-id.ts, which imports
// nothing so that the Edge-runtime proxy can reach it too. Re-exported here
// because this file is where callers already come for identity.
export type { UserId } from "@/lib/user-id";
export { asUserId } from "@/lib/user-id";

/**
 * The database handle passed to a `withUser` callback. It is bound to one
 * reserved connection with a hand-rolled BEGIN...COMMIT around it (see below),
 * not the pooled client, and it is the only handle inside the callback that
 * carries the caller's identity.
 */
export type UserScopedDb = ReturnType<typeof drizzle<typeof schema>>;


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
  //   2. A withUser nested inside another withUser would run set_config on the
  //      OUTER transaction. set_config(..., true) is reverted at the end of the
  //      transaction, not at the end of a savepoint, so the inner user's id
  //      would stay in effect for the rest of the outer scope. A helper meant to
  //      isolate users would be the thing that mixed them.
  //
  // Exiting the store means every withUser gets its own transaction with its own
  // context and its own lifetime, which is the only version of this that is
  // safe to call from anywhere.
  //
  // ── Why BEGIN and set_config share a round trip ────────────────────────────
  //
  // drizzle's db.transaction() sends BEGIN and waits for it before the
  // callback runs, so a first statement issued from inside the callback (the
  // set_config call) is a second, separate wire round trip -- and over the
  // Supabase pooler each round trip measures ~50ms, which a Today-screen load
  // pays nine times over (see db/index.ts). sql.reserve() hands back one
  // physical connection with nothing sent on it yet, which makes it possible
  // to write BEGIN and the set_config call as one multi-statement string and
  // ship them together. Everything after that -- the callback's queries, and
  // COMMIT/ROLLBACK -- still costs the same round trips it always did; this
  // removes exactly one, the one that was pure fixed overhead before any real
  // query ran.
  //
  // The transaction-scoping guarantee is identical to db.transaction(): BEGIN
  // opens it, set_config's third argument still scopes the value to it, and
  // COMMIT/ROLLBACK still end it -- verified directly (a second, unrelated
  // "request" reserving the same physical connection afterwards sees no
  // context at all). The only thing that changed is which round trip BEGIN's
  // acknowledgement travels in.
  const lowerUserId = userId.toLowerCase();
  return txStore.exit(async () => {
    const reserved = await getClient().reserve();
    try {
      await reserved.unsafe(
        `BEGIN; SELECT set_config('app.user_id', '${lowerUserId}', true);`
      );
      const tx: UserScopedDb = drizzle(reserved, { schema });
      // Publish the handle for the duration of `fn` so that plain `db`
      // usage underneath it runs here, on the connection that carries the
      // context, rather than on a pooled connection that does not.
      const result = await txStore.run({ tx, userId: lowerUserId }, () => fn(tx));
      await reserved`COMMIT`;
      return result;
    } catch (err) {
      // Best-effort: the connection is dropped either way (release() below
      // returns it to the pool only once idle), so a ROLLBACK that itself
      // fails here does not leave the transaction open on a reused connection.
      await reserved`ROLLBACK`.catch(() => {});
      throw err;
    } finally {
      reserved.release();
    }
  });
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
