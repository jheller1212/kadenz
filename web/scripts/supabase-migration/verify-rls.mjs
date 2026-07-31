// Verifies the four claims the Neon->Supabase cutover depends on:
//
//   1. pg_class.relforcerowsecurity is true on every tenanted table (not just
//      pg_tables.rowsecurity — ENABLE alone is true in both the safe and the
//      unsafe case, see drizzle/0053_rls.sql for why that column proves
//      nothing).
//   2. The connecting role is actually subject to that: not a superuser, and
//      does not carry BYPASSRLS. Either one makes FORCE meaningless, silently.
//   3. SET LOCAL app.user_id (via set_config(..., true) inside a transaction)
//      survives the round trip on THIS connection string — the one the app
//      will actually use, i.e. the pooler if that is what you point it at.
//   4. Two different app.user_id contexts see two disjoint sets of rows: a
//      real cross-user isolation check, not just a schema inspection.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/supabase-migration/verify-rls.mjs
//
// Safety: refuses to run unless the URL host looks like Supabase
// (*.supabase.co / *.supabase.com / *.pooler.supabase.com) or the caller
// passes --allow-local-rehearsal for the local embedded-postgres harness.
// This is a read/write test against tenanted tables (it inserts and deletes
// two throwaway rows per tenanted table) and must never run against Neon
// production.

import postgres from "postgres";

const ALLOW_LOCAL = process.argv.includes("--allow-local-rehearsal");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL must be set.");
    process.exit(1);
  }

  const host = new URL(url.replace(/^postgres(ql)?:\/\//, "http://")).hostname;
  const looksLikeSupabase = /supabase\.(co|com)$/.test(host);
  const looksLikeLocal = host === "127.0.0.1" || host === "localhost";

  if (!looksLikeSupabase && !(looksLikeLocal && ALLOW_LOCAL)) {
    console.error(
      `Refusing to run against host "${host}". This script writes and deletes ` +
        "throwaway rows in tenanted tables and must only run against a Supabase " +
        "host, or localhost with --allow-local-rehearsal."
    );
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
  let failures = 0;
  const ok = (label) => console.log(`  OK   ${label}`);
  const fail = (label, detail) => {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  };

  try {
    // ── 0. Who are we? ─────────────────────────────────────────────────────
    const [role] = await sql`
      SELECT rolname, rolsuper, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `;
    console.log(`\nConnected as "${role.rolname}" (rolsuper=${role.rolsuper}, rolbypassrls=${role.rolbypassrls})`);
    if (role.rolsuper || role.rolbypassrls) {
      fail(
        "connection role is subject to RLS",
        `${role.rolname} has ${role.rolsuper ? "SUPERUSER" : "BYPASSRLS"} — FORCE ROW LEVEL SECURITY has no effect on this role at all`
      );
    } else {
      ok("connection role has neither SUPERUSER nor BYPASSRLS");
    }

    // ── 1. FORCE is set on every tenanted table ────────────────────────────
    // Same discovery query as drizzle/0068_rls_covers_every_tenanted_table.sql:
    // every table with a user_id column, minus the same named exceptions.
    const tenanted = await sql`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'user_id'
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND c.relname <> 'user_identities'
      ORDER BY c.relname
    `;
    const childTables = ["strength_sets", "pain_logs", "custom_workout_slots"];
    const [childRows] = await sql`
      SELECT array_agg(relname ORDER BY relname) AS names
      FROM pg_class
      WHERE relname = ANY(${childTables}) AND relkind = 'r'
    `;
    const allTenanted = [
      ...tenanted.map((t) => t.relname),
      ...(childRows.names ?? []),
    ];
    if (allTenanted.length === 0) {
      fail("tenanted table discovery", "found zero tables — is the migration chain applied?");
    } else {
      console.log(`\nChecking FORCE ROW LEVEL SECURITY on ${allTenanted.length} tenanted tables…`);
      for (const name of tenanted) {
        if (!name.relforcerowsecurity) {
          fail(`relforcerowsecurity on ${name.relname}`, `relrowsecurity=${name.relrowsecurity} relforcerowsecurity=${name.relforcerowsecurity}`);
        } else {
          ok(`relforcerowsecurity on ${name.relname}`);
        }
      }
      for (const name of childRows.names ?? []) {
        const [row] = await sql`SELECT relforcerowsecurity FROM pg_class WHERE relname = ${name}`;
        if (!row?.relforcerowsecurity) {
          fail(`relforcerowsecurity on ${name} (child table)`);
        } else {
          ok(`relforcerowsecurity on ${name} (child table)`);
        }
      }
    }

    // ── 2/3. SET LOCAL survives an explicit transaction on this connection ──
    console.log("\nChecking SET LOCAL app.user_id inside an explicit transaction…");
    const testUserA = "00000000-0000-0000-0000-0000000000a1";
    const testUserB = "00000000-0000-0000-0000-0000000000a2";

    // sync_outbox needs only columns the isolation check itself provides
    // (entity_type/entity_id/action/target have no further FKs), unlike
    // profiles which carries required onboarding columns unrelated to what
    // this check is proving. Any tenanted table would do for the mechanics.
    const hasTarget = tenanted.some((t) => t.relname === "sync_outbox");
    if (!hasTarget) {
      fail("SET LOCAL round trip", "sync_outbox table not found — cannot run the isolation check");
    } else {
      const readBack = await sql.begin(async (tx) => {
        await tx`SELECT set_config('app.user_id', ${testUserA}, true)`;
        const [row] = await tx`SELECT current_setting('app.user_id', true) AS v`;
        return row.v;
      });
      if (readBack === testUserA) {
        ok("SET LOCAL via set_config survives inside the same transaction");
      } else {
        fail("SET LOCAL via set_config", `expected ${testUserA}, got ${readBack}`);
      }

      // Confirm it does NOT survive across transactions on the same pooled
      // connection — this is what makes the pooler safe to share.
      const afterCommit = await sql`SELECT current_setting('app.user_id', true) AS v`;
      if (afterCommit[0].v === "" || afterCommit[0].v === null) {
        ok("app.user_id does not leak past COMMIT (safe under the transaction pooler)");
      } else {
        fail("app.user_id leaked past COMMIT", `still reads "${afterCommit[0].v}" — this IS a cross-request leak under a pooler`);
      }

      // ── 4. Two-user isolation, for real rows ───────────────────────────
      console.log("\nChecking two-user row isolation on sync_outbox…");
      // Need a users row to satisfy the FK before sync_outbox can reference it.
      // We do this with the users table, which carries no RLS policy (identity,
      // not tenanted data — see drizzle/0053_rls.sql), so a plain insert works
      // regardless of app.user_id context.
      await sql`
        INSERT INTO users (id, display_name) VALUES
          (${testUserA}, 'rls-check-a'),
          (${testUserB}, 'rls-check-b')
        ON CONFLICT (id) DO NOTHING
      `;
      const markerA = "00000000-0000-0000-0000-0000000000e1";
      const markerB = "00000000-0000-0000-0000-0000000000e2";

      try {
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserA}, true)`;
          await tx`INSERT INTO sync_outbox (entity_type, entity_id, action, target, user_id) VALUES ('plan', ${markerA}, 'create', 'gcal', ${testUserA})`;
        });
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserB}, true)`;
          await tx`INSERT INTO sync_outbox (entity_type, entity_id, action, target, user_id) VALUES ('plan', ${markerB}, 'create', 'gcal', ${testUserB})`;
        });

        const seenByB = await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserB}, true)`;
          return tx`SELECT user_id FROM sync_outbox WHERE entity_id = ${markerA}`;
        });
        if (seenByB.length === 0) {
          ok("user B cannot read user A's sync_outbox row");
        } else {
          fail("user B read user A's sync_outbox row", `${seenByB.length} row(s) leaked`);
        }

        const seenByA = await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserA}, true)`;
          return tx`SELECT user_id FROM sync_outbox WHERE entity_id = ${markerA}`;
        });
        if (seenByA.length === 1) {
          ok("user A can read their own sync_outbox row");
        } else {
          fail("user A could not read their own row", `expected 1, got ${seenByA.length}`);
        }

        // No context at all => nothing visible (fail closed).
        const seenByNoContext = await sql`SELECT user_id FROM sync_outbox WHERE entity_id IN (${markerA}, ${markerB})`;
        if (seenByNoContext.length === 0) {
          ok("no app.user_id context => zero rows visible (fails closed)");
        } else {
          fail("connection with no context saw rows", `${seenByNoContext.length} row(s) visible with no context set`);
        }
      } finally {
        // Cleanup: the pooled/superuser-less role is still bound by RLS, so
        // cleanup must happen inside each user's own context.
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserA}, true)`;
          await tx`DELETE FROM sync_outbox WHERE entity_id = ${markerA}`;
        });
        await sql.begin(async (tx) => {
          await tx`SELECT set_config('app.user_id', ${testUserB}, true)`;
          await tx`DELETE FROM sync_outbox WHERE entity_id = ${markerB}`;
        });
        await sql`DELETE FROM users WHERE id IN (${testUserA}, ${testUserB})`;
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }

  console.log("");
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED. Do not cut over until these are resolved.`);
    process.exit(1);
  }
  console.log("All RLS checks passed.");
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(1);
});
