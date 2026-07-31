import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { txStore } from "./tx-store";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

// Lazily create the client on first query, NOT at import. `next build` imports
// every route module to collect page data but never runs a query, so throwing
// on a missing DATABASE_URL at import time breaks the build in any environment
// without the secret (CI). Deferring the check keeps the fail-fast guarantee
// where it matters — the first real query — while letting the build proceed.
let cached: DrizzleDb | null = null;

function getDb(): DrizzleDb {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL env var is not set");
  // Serverless connection hygiene. On Vercel every route runs in its own
  // short-lived function instance, and a single Today-screen load fans out ~9
  // parallel API calls — each a separate instance. postgres.js defaults to a
  // pool of 10 per client, so without a cap a burst opens dozens of connections
  // at once and Neon rejects them ("too many database connection attempts …",
  // CONNECT_TIMEOUT). One connection per instance keeps the burst bounded; the
  // pooled Neon endpoint (…-pooler.…) multiplexes them safely.
  const client = postgres(url, {
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  cached = drizzle(client, { schema });
  return cached;
}

// A thin proxy so `db.select(...)`, `db.query.x`, `db.insert(...)` etc. all work
// exactly as before, but the underlying client is built on first access.
//
// It also resolves to the caller's transaction when there is one. withUser()
// (db/with-user.ts) opens a transaction, sets the row level security context
// on it with SET LOCAL, and publishes it on an AsyncLocalStorage store. Every
// `db` access beneath that call then lands on that transaction, so the ~62
// query call sites across the app inherit the caller's identity without any of
// them being rewritten to thread a handle through.
//
// The alternative was passing a `tx` parameter down through every helper in
// src/lib. That was rejected because a helper someone forgot to convert would
// keep using the pooled client, and the resulting query would silently run
// with no context. Resolving centrally means there is one place that decides,
// and no call site can get it wrong by omission.
//
// Note the ordering: the store is consulted on every property access, not
// captured once, because a single module-level `db` import is shared by
// requests that are each inside a different transaction.
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = (txStore.getStore()?.tx as DrizzleDb | undefined) ?? getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export * from "./schema";
