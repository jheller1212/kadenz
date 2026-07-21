import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

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
export const db = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real as object, prop, receiver);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export * from "./schema";
