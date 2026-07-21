import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL env var is not set");

// Serverless connection hygiene. On Vercel every route runs in its own
// short-lived function instance, and a single Today-screen load fans out ~9
// parallel API calls — each a separate instance. postgres.js defaults to a
// pool of 10 per client, so without a cap a burst opens dozens of connections
// at once and Neon rejects them ("too many database connection attempts …",
// CONNECT_TIMEOUT) — which white-screens the whole app because every panel's
// fetch fails together. One connection per instance keeps the burst bounded;
// the pooled Neon endpoint (…-pooler.…) multiplexes them safely.
//   • max 1            — never hold a pool inside a single-request instance
//   • idle_timeout 20  — hand the connection back quickly between invocations
//   • connect_timeout  — fail fast instead of hanging the request
//   • prepare: false   — required for the pooler's transaction mode; a no-op
//                        (minor perf) on a direct endpoint, so safe either way
const client = postgres(url, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 15,
  prepare: false,
});

export const db = drizzle(client, { schema });

export * from "./schema";
