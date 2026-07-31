// Verifies that the FULL drizzle/ migration chain (0000 through the highest
// numbered file) applies cleanly, in order, to an empty Postgres.
//
// This is deliberately NOT scripts/migrate.mjs and NOT e2e/apply-rls.ts:
//
//   - scripts/migrate.mjs skips files numbered below 0002 on purpose, because
//     production was bootstrapped with `drizzle-kit push` and 0000/0001 were
//     never meant to run there. A fresh Supabase database was never bootstrapped
//     that way, so it needs 0000 and 0001 too, or the run starts from a schema
//     that does not exist yet.
//   - e2e/apply-rls.ts only ever applies 0053+ on top of a schema pushed
//     directly from src/db/schema.ts via `drizzle-kit push`. It never exercises
//     the hand-authored 0000-0052 chain at all, so it cannot catch a migration
//     that assumes state a fresh database does not have.
//
// Unlike scripts/migrate.mjs, a failed statement here is FATAL and stops the
// whole run immediately with the file, statement index and full statement
// text. The point of this script is to find the exact thing that breaks on a
// truly empty database, not to keep going and hide it.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/supabase-migration/verify-fresh-chain.mjs
//
// The target database must be empty (no tables in the public schema) or this
// refuses to run, because a partial pre-existing schema would make "it applied
// cleanly" a meaningless claim.

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "..", "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, onnotice: (n) => console.log(`  [notice] ${n.message}`) });

  try {
    const existing = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public'
    `;
    if (existing[0].n > 0) {
      console.error(
        `Target database already has ${existing[0].n} table(s) in public. ` +
          "This script only proves something on a truly empty database. " +
          "Point it at a fresh database (or drop/recreate the schema) and re-run."
      );
      process.exit(1);
    }

    // Every migration file, 0000 included. Sorted lexically, which matches
    // numeric order because every filename is a zero-padded 4-digit prefix.
    const files = readdirSync(drizzleDir)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();

    console.log(`Applying ${files.length} migration files to an empty database…\n`);

    let totalStatements = 0;
    for (const file of files) {
      const raw = readFileSync(join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);

      let applied = 0;
      for (const stmt of statements) {
        try {
          await sql.unsafe(stmt);
          applied++;
          totalStatements++;
        } catch (err) {
          console.error(`\n${"=".repeat(72)}`);
          console.error(`FAILED: ${file}, statement ${applied + 1} of ${statements.length}`);
          console.error(`${"=".repeat(72)}`);
          console.error(err?.message ?? err);
          console.error("\n--- statement text ---");
          console.error(stmt);
          console.error("=".repeat(72));
          process.exitCode = 1;
          return;
        }
      }
      console.log(`  ${file}: ${applied} statement(s) ok`);
    }

    console.log(`\nAll ${files.length} files applied cleanly (${totalStatements} statements total).`);

    // Sanity: confirm the chain actually produced tables, not just types/no-ops.
    const tableCount = await sql`
      SELECT count(*)::int AS n FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;
    console.log(`public schema now has ${tableCount[0].n} base tables.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(1);
});
