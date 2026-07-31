import { test, expect } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL } from "../env";

// ── RLS coverage: what drizzle/0053_rls.sql claims, checked for real ────────
//
// That migration's own comments make two promises twice over: every tenanted
// table has FORCE ROW LEVEL SECURITY, and no tenanted user_id column carries
// a column default. Neither was ever actually checked — the file it pointed
// to (src/db/__tests__/rls-coverage.test.ts) didn't exist, and the nearby
// src/db/__tests__/tenancy.test.ts only inspects the drizzle schema shape in
// memory; it never opens a database, so it can't see a policy or a FORCE flag
// either way. A comment that promises a check nobody wrote is worse than no
// comment.
//
// This lives here, not as a Vitest unit test, because both assertions are
// fundamentally "ask a real Postgres what it thinks", and a real Postgres
// with these exact migrations applied is already sitting there for the rest
// of this suite (e2e/apply-rls.ts, run once by global-setup.ts) — this file
// just opens a second, direct connection to it and reads its catalogs. No
// app code, no session, no seeded data needed — independent of everything
// e2e/seed.ts writes, so it doesn't care where in the run order Playwright
// places it relative to cross-user-isolation.spec.ts.
//
// Connects directly with `postgres`, the same driver apply-rls.ts uses,
// rather than through drizzle — pg_class/information_schema aren't part of
// the app's schema, there's nothing here for an ORM to buy.

const sql = postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

// Tables that intentionally have NO row level security, despite (in
// user_identities' case) carrying a column literally named user_id — see
// drizzle/0053_rls.sql's "Left without policies, on purpose" section for the
// reasoning behind each. Kept here, explicit and named, rather than inferred:
// adding a fourth exception is then a deliberate edit to this array, not a
// query that silently stops flagging a table.
const NON_TENANTED_EXCEPTIONS = ["users", "user_identities", "strength_exercises"];

// The three child tables enforced via an EXISTS join to their parent's
// user_id rather than carrying their own — see drizzle/0053_rls.sql's "The
// child tables" section. They have no user_id column, so the information_
// schema query below (which is how every other tenanted table is found)
// cannot discover them; they're the one hardcoded list in this file, for
// exactly that structural reason, not because deriving them was skipped.
const CHILD_TABLES = ["strength_sets", "pain_logs", "custom_workout_slots"];

/** Every base table in the public schema with a column literally named
 *  user_id — derived from the database, not hand-maintained, so a table
 *  added later and left off drizzle/0053_rls.sql's ENABLE/FORCE loop fails
 *  this test instead of shipping as a silent leak. */
async function tablesWithUserIdColumn(): Promise<string[]> {
  const rows = await sql<{ table_name: string }[]>`
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'user_id'
    ORDER BY table_name
  `;
  return rows.map((r) => r.table_name);
}

/** pg_class.relforcerowsecurity for each named table — NOT
 *  pg_tables.rowsecurity. See drizzle/0053_rls.sql's "FORCE, not just
 *  ENABLE" section: the weaker column reads true whether or not FORCE is
 *  set, because Postgres exempts a table's owner from ENABLE-only policies
 *  and the app connects as the owning role, so asserting on it would prove
 *  nothing — a green check over a total leak, indistinguishable from a real
 *  fix in the one column that looks easiest to assert on. */
async function forceRlsByTable(tables: string[]): Promise<Map<string, boolean>> {
  const rows = await sql<{ relname: string; relforcerowsecurity: boolean }[]>`
    SELECT c.relname, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY(${tables})
  `;
  return new Map(rows.map((r) => [r.relname, r.relforcerowsecurity]));
}

test.describe("RLS coverage (drizzle/0053_rls.sql)", () => {
  test("every tenanted table, and its child tables, has FORCE ROW LEVEL SECURITY", async () => {
    const tenanted = (await tablesWithUserIdColumn()).filter((t) => !NON_TENANTED_EXCEPTIONS.includes(t));
    expect(tenanted.length, "no tables with a user_id column were found at all — is the e2e schema actually pushed?").toBeGreaterThan(0);

    const allChecked = [...tenanted, ...CHILD_TABLES];
    const forced = await forceRlsByTable(allChecked);

    const missing = allChecked.filter((t) => !forced.has(t));
    expect(missing, `table(s) not found in pg_class at all: ${missing.join(", ")}`).toEqual([]);

    const notForced = allChecked.filter((t) => forced.get(t) !== true);
    expect(
      notForced,
      `table(s) missing FORCE ROW LEVEL SECURITY (checked pg_class.relforcerowsecurity, not the weaker ` +
        `pg_tables.rowsecurity — see this file's header comment for why that distinction matters): ${notForced.join(", ")}`
    ).toEqual([]);
  });

  test("users, user_identities and strength_exercises are NOT force-RLS-enabled", async () => {
    // The negative case matters as much as the positive one: withUser() and
    // the OAuth callback both have to read `users` before any request
    // context exists (see drizzle/0053_rls.sql), so FORCE landing on it by
    // accident would deadlock login itself, not just fail a test.
    const forced = await forceRlsByTable(NON_TENANTED_EXCEPTIONS);
    const wronglyForced = NON_TENANTED_EXCEPTIONS.filter((t) => forced.get(t) === true);
    expect(wronglyForced, `table(s) unexpectedly FORCE-RLS-enabled: ${wronglyForced.join(", ")}`).toEqual([]);
  });

  test("no tenanted user_id column carries a column default", async () => {
    // Re-adding a default here is exactly how a forgotten user_id on an
    // insert stops being a loud not-null violation and becomes a silent
    // misattribution to whoever the default names — see drizzle/0053_rls.sql
    // "WITH CHECK, and why the Phase 2 defaults must go".
    const tenanted = (await tablesWithUserIdColumn()).filter((t) => !NON_TENANTED_EXCEPTIONS.includes(t));

    const rows = await sql<{ table_name: string; column_default: string | null }[]>`
      SELECT table_name, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'user_id' AND table_name = ANY(${tenanted})
    `;

    const withDefault = rows.filter((r) => r.column_default != null);
    expect(
      withDefault.map((r) => `${r.table_name}.user_id = ${r.column_default}`),
      "tenanted table(s) whose user_id column still carries a default"
    ).toEqual([]);
  });
});
