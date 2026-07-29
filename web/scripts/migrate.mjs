// Fail-safe migration runner for the Vercel build step.
//
// Applies the hand-authored, idempotent SQL migrations (0002+) directly with
// the postgres client — NOT drizzle-kit migrate, because the production
// database was bootstrapped via `drizzle-kit push` and has no __drizzle_migrations
// journal, so the migrator would try to re-run the non-idempotent 0000 baseline
// and fail. Files 0001+ guard every statement (IF NOT EXISTS / DO…EXCEPTION),
// so re-running them on an up-to-date database is a harmless no-op.
//
// This script NEVER fails the build:
//   • no DATABASE_URL  → log + exit 0 (local/preview builds without the secret)
//   • migration error  → log + exit 0 (site still ships; schema stays as-is)
// The worst case is that new schema-dependent features stay dormant until the
// migration succeeds — never a regression from today's state.
//
// ── If you are writing a migration, three behaviours to design around ────────
//
// 1. A failed statement ABANDONS THE REST OF ITS FILE. The loop below catches
//    per file, not per statement, so statement 40 failing means statements 41
//    onward never run — on this deploy and on every deploy after, since the
//    same statement fails again next time. A file that migrates many tables
//    therefore leaves every table after the failure untouched. Put any
//    statement that can legitimately fail LAST, or make it swallow its own
//    error (DO $$ … EXCEPTION WHEN … THEN RAISE WARNING … END $$), so it
//    cannot take the rest of the file down with it.
//
// 2. Each statement runs on its own, with NO SURROUNDING TRANSACTION, against
//    a live database. The cron sync and the Strava and Garmin webhooks keep
//    writing throughout. Anything that reasons about the current contents of a
//    table has a window in which new rows can appear. Adding a NOT NULL
//    column is the classic case: set the DEFAULT before backfilling, never
//    after, or a row inserted between the backfill and the SET NOT NULL
//    arrives null and fails the constraint (see 0052).
//
// 3. The build stays green either way. Nothing here surfaces a failed
//    migration except these logs, so a half-applied file is invisible unless
//    someone reads the build output. Assume nobody will. That is the reason
//    for points 1 and 2 rather than a promise to check afterwards.

import postgres from "postgres";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.warn("[migrate] DATABASE_URL not set — skipping migrations.");
    return;
  }

  // Only the idempotent, hand-authored migrations (skip the 0000 baseline).
  const files = readdirSync(drizzleDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .filter((f) => parseInt(f.slice(0, 4), 10) >= 2)
    .sort();

  if (files.length === 0) {
    console.log("[migrate] no idempotent migrations found.");
    return;
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const failures = [];
  try {
    for (const file of files) {
      const raw = readFileSync(join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);
      let applied = 0;
      try {
        for (const stmt of statements) {
          await sql.unsafe(stmt);
          applied++;
        }
        console.log(`[migrate] ${file}: ${applied} statement(s) ok`);
      } catch (err) {
        // One bad file must not hide every migration behind it — record it
        // and keep going, then report loudly at the end.
        failures.push({ file, statement: applied + 1, message: err?.message ?? String(err) });
        console.error(`[migrate] ${file}: FAILED at statement ${applied + 1}: ${err?.message ?? err}`);
      }
    }
    if (failures.length > 0) {
      console.error("");
      console.error("=".repeat(72));
      console.error(`[migrate] ${failures.length} MIGRATION(S) FAILED — the schema is not what the code expects:`);
      for (const f of failures) {
        console.error(`  - ${f.file} (statement ${f.statement}): ${f.message}`);
      }
      console.error("=".repeat(72));
      console.error("");
    } else {
      console.log("[migrate] done.");
    }
  } catch (err) {
    console.error("[migrate] error (build continues):", err?.message ?? err);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .catch((err) => console.error("[migrate] unexpected (build continues):", err?.message ?? err))
  .finally(() => process.exit(0));
