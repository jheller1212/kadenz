import { AsyncLocalStorage } from "node:async_hooks";

// The database context the current async call chain is running inside, if any.
//
// This lives in its own module, importing nothing, purely to break a cycle:
// db/index.ts needs to read the store to resolve `db`, and db/with-user.ts
// needs `db` in order to open the transaction it puts into the store. With the
// store in a third module both can import it and neither imports the other.
//
// The tx type is deliberately loose. Naming the drizzle transaction type here
// would mean importing the schema, which reintroduces the cycle. db/index.ts
// casts on the way out and with-user.ts is the only writer, so the precise
// type is enforced at both ends where it matters.
//
// `userId` rides along with the transaction rather than being kept in a second
// store, because the two must never disagree: it is the same value that was
// written to `app.user_id` on this connection. A route that filters by
// currentUserId() and a policy that filters by app.user_id are then provably
// filtering by the same thing.
//
// Application code must not import this. Use `db` (which consults it),
// `withUser` (which populates it) or `currentUserId()`.
export type RequestContext = {
  /** The drizzle transaction carrying this request's RLS context. */
  tx: unknown;
  /** The user that transaction's `app.user_id` is set to. */
  userId: string;
};

export const txStore = new AsyncLocalStorage<RequestContext>();
