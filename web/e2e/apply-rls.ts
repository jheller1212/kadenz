// Applies the Phase 3 enforcement SQL to the e2e database.
//
// ── Why this step has to exist ───────────────────────────────────────────────
//
// global-setup builds the test database with `drizzle-kit push`, which derives
// tables and indexes from src/db/schema.ts and replays no migration files.
// That is fine for schema, but row level security is not expressible in
// schema.ts: the policies, the FORCE flags and the dropped column defaults all
// live in hand-written SQL (drizzle/0053_rls.sql, drizzle/0054_*.sql).
//
// So without this step the test database would have every table and no
// policies, and the leak test would pass by testing nothing -- the same shape
// of false green as asserting on pg_tables.rowsecurity instead of
// pg_class.relforcerowsecurity. A suite whose whole purpose is proving
// isolation must not run against a database that has none.
//
// It executes the real migration files rather than a copy of their contents,
// so there is nothing to drift: editing a policy in drizzle/ changes what the
// tests run against.
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

// Everything from 0053 on is Phase 3 enforcement, and is picked up by number
// rather than by name so that a later migration adding policies for a new
// table is applied here automatically instead of being silently skipped.
const FIRST_ENFORCEMENT_MIGRATION = 53;

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("[e2e:rls] DATABASE_URL must be set — refusing to run.");
  }

  const files = readdirSync(drizzleDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => parseInt(f.slice(0, 4), 10) >= FIRST_ENFORCEMENT_MIGRATION)
    .sort();

  if (files.length === 0) {
    throw new Error(
      `[e2e:rls] no migration at or after ${FIRST_ENFORCEMENT_MIGRATION} was found. ` +
        "The enforcement SQL is what the isolation specs exist to verify, so " +
        "running them without it would prove nothing. Refusing to continue."
    );
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const file of files) {
      const raw = readFileSync(join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);
      for (const stmt of statements) {
        // Unlike scripts/migrate.mjs, a failure here is fatal. That script
        // must never break a production build over a migration; this one is
        // setting up the very thing the suite measures, so a half-applied
        // policy set has to stop the run rather than produce a green suite.
        await sql.unsafe(stmt);
      }
      console.log(`[e2e:rls] applied ${file} (${statements.length} statements)`);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[e2e:rls] failed:", err);
  process.exit(1);
});
