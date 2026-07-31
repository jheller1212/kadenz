// Local rehearsal harness: boots a disposable embedded Postgres (same package
// the e2e suite uses, see e2e/global-setup.ts), creates a non-superuser role
// that OWNS the schema it creates (to mirror Neon/Supabase, where the app
// connects as the table owner but NOT as a superuser), runs the full
// migration chain as that role, then runs the RLS checks from
// verify-rls.mjs against it.
//
// This exists because there is no local Postgres/Docker in this environment,
// and because testing FORCE ROW LEVEL SECURITY as the embedded-postgres
// default "postgres" superuser would prove nothing: superusers and roles with
// BYPASSRLS always bypass row security, FORCE or not. A rehearsal that
// connected as that role would show every check passing whether or not FORCE
// actually works, which is worse than not testing at all.
//
// This is NOT a substitute for running verify-fresh-chain.mjs and
// verify-rls.mjs against the real Supabase project. It proves the migration
// chain and the RLS mechanics are sound in principle, on Postgres (version
// noted in the output — this environment's embedded binary is 18.x, the
// Supabase project is 17.x; FORCE RLS semantics have not changed between
// those versions but this is a real, disclosed version mismatch, not 17).

import EmbeddedPostgres from "embedded-postgres";
import postgres from "postgres";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, "..", "..", "drizzle");
const dataDir = join(here, ".rehearsal-pgdata");
const port = 54399;
const dbName = "kadenz_rehearsal";
const appRole = "kadenz_app_owner";
const appPassword = "rehearsal-only";

async function applyChain(sql, files) {
  let total = 0;
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
        total++;
      } catch (err) {
        console.error(`FAILED: ${file} statement ${applied + 1}/${statements.length}`);
        console.error(err?.message ?? err);
        console.error(stmt);
        throw err;
      }
    }
    console.log(`  ${file}: ${applied} ok`);
  }
  return total;
}

async function main() {
  rmSync(dataDir, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
  });

  await pg.initialise();
  await pg.start();

  console.log(`[rehearsal] engine: embedded-postgres 18.x (Supabase project is Postgres 17.x — see caveat above)`);

  const adminUrl = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });

  try {
    await admin.unsafe(`CREATE ROLE ${appRole} LOGIN PASSWORD '${appPassword}' NOSUPERUSER NOBYPASSRLS CREATEDB`);
    await admin.unsafe(`CREATE DATABASE ${dbName} OWNER ${appRole}`);
  } finally {
    await admin.end({ timeout: 5 });
  }

  const appUrl = `postgres://${appRole}:${appPassword}@127.0.0.1:${port}/${dbName}`;
  const app = postgres(appUrl, { max: 1, onnotice: () => {} });

  const files = readdirSync(drizzleDir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f))
    .sort();

  console.log(`\n[rehearsal] applying ${files.length} migration files as non-superuser owner "${appRole}"…`);
  try {
    const total = await applyChain(app, files);
    console.log(`[rehearsal] chain applied cleanly: ${total} statements across ${files.length} files.\n`);
  } finally {
    await app.end({ timeout: 5 });
  }

  console.log(`[rehearsal] DATABASE_URL for the RLS checks:\n  ${appUrl}\n`);
  console.log("[rehearsal] run: DATABASE_URL='" + appUrl + "' node scripts/supabase-migration/verify-rls.mjs --allow-local-rehearsal");
  console.log("[rehearsal] Postgres left running on port " + port + " until you Ctrl+C this process.");

  process.on("SIGINT", async () => {
    await pg.stop();
    process.exit(0);
  });
  // Keep alive for the follow-up verify-rls.mjs run.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
