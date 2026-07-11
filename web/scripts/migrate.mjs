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
  try {
    for (const file of files) {
      const raw = readFileSync(join(drizzleDir, file), "utf8");
      const statements = raw
        .split("--> statement-breakpoint")
        .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
        .filter(Boolean);
      let applied = 0;
      for (const stmt of statements) {
        await sql.unsafe(stmt);
        applied++;
      }
      console.log(`[migrate] ${file}: ${applied} statement(s) ok`);
    }
    console.log("[migrate] done.");
  } catch (err) {
    console.error("[migrate] error (build continues):", err?.message ?? err);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main()
  .catch((err) => console.error("[migrate] unexpected (build continues):", err?.message ?? err))
  .finally(() => process.exit(0));
