import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../schema";

// Phase 2 of the multi-user plan added a user_id column to every table that
// holds a person's own data. This test is the tripwire for that convention:
// a future table added without tenancy should fail here, not get discovered
// as a data leak once Phase 3 wires up row level security.

const TENANTED_TABLES = {
  plans: schema.plans,
  weeks: schema.weeks,
  workouts: schema.workouts,
  blocks: schema.blocks,
  activities: schema.activities,
  deletedActivities: schema.deletedActivities,
  activityTrash: schema.activityTrash,
  personalRecords: schema.personalRecords,
  syncOutbox: schema.syncOutbox,
  wellnessMetrics: schema.wellnessMetrics,
  pushSubscriptions: schema.pushSubscriptions,
  reminderSettings: schema.reminderSettings,
  sentReminders: schema.sentReminders,
  strengthSessions: schema.strengthSessions,
  wellnessLogs: schema.wellnessLogs,
  strengthPlanSettings: schema.strengthPlanSettings,
  customWorkoutTemplates: schema.customWorkoutTemplates,
  profiles: schema.profiles,
  // Phase 4. These two are tenanted by construction rather than by a
  // backfilled column: their userId has no DB default, because a credential
  // or an import bookmark with no known owner is not a thing that should
  // exist. They are listed here so the exhaustiveness check below stays a
  // real tripwire.
  integrationCredentials: schema.integrationCredentials,
  userIntegrationState: schema.userIntegrationState,
} as const;

// Deliberately not tenanted:
//   - users: the identity table itself, not a user's data.
//   - emailLoginTokens: identity infrastructure, same category as
//     user_identities below -- a requested magic-link token exists before we
//     know which user (if any) it will resolve to, so it cannot carry a
//     user_id. See drizzle/0067_email_login_tokens.sql.
//   - strengthExercises: a shared catalogue, not anyone's data.
//   - strengthSets, painLogs, customWorkoutSlots: each reachable only through
//     an already-tenanted parent row (strengthSessions or
//     customWorkoutTemplates), so tenancy on the parent is enough for now.
//     Phase 3 decides whether to duplicate user_id onto the child for query
//     convenience.
//
// userIdentities is excluded from this list on purpose, not just left off:
// it already has its own userId column (the FK from an OAuth account to the
// user it belongs to, added in Phase 1) which is a pre-existing column, not
// Phase 2 tenancy, so it would fail the "has no userId" assertion below for
// an unrelated reason. It is not a table with a Phase 2 tenancy column.
const EXCLUDED_TABLES = {
  users: schema.users,
  emailLoginTokens: schema.emailLoginTokens,
  strengthExercises: schema.strengthExercises,
  strengthSets: schema.strengthSets,
  painLogs: schema.painLogs,
  customWorkoutSlots: schema.customWorkoutSlots,
} as const;

describe("tenancy: every user-owned table has a user_id column", () => {
  for (const [name, table] of Object.entries(TENANTED_TABLES)) {
    it(`${name} has a userId column`, () => {
      const columns = getTableColumns(table);
      expect(columns).toHaveProperty("userId");
    });
  }
});

describe("tenancy: shared/catalogue and child-of-tenanted tables have no user_id column", () => {
  for (const [name, table] of Object.entries(EXCLUDED_TABLES)) {
    it(`${name} does not have a userId column`, () => {
      const columns = getTableColumns(table);
      expect(columns).not.toHaveProperty("userId");
    });
  }
});

// The two lists above are only a tripwire if they are exhaustive. Without
// this, a new table would simply appear in neither list and the tripwire
// would pass while the table sat untenanted. Adding a table therefore forces
// a deliberate choice: tenanted, or excluded with a reason.
describe("tenancy: every table in the schema is accounted for", () => {
  it("has no table that is neither tenanted nor deliberately excluded", () => {
    const listed = new Set([
      ...Object.values(TENANTED_TABLES),
      ...Object.values(EXCLUDED_TABLES),
      // Identity, not tenanted data. It carries its own userId (the FK from
      // an OAuth account to its user, added in Phase 1), which is why it
      // cannot sit in EXCLUDED_TABLES above.
      schema.userIdentities,
    ]);

    const unaccounted = Object.entries(schema)
      .filter(([, value]) => is(value, PgTable))
      .filter(([, table]) => !listed.has(table as never))
      .map(([name]) => name);

    expect(unaccounted).toEqual([]);
  });
});

// ── The check that matters: is the column actually enforced ──────────────────
//
// Everything above asserts a user_id column EXISTS. That is a weaker claim than
// it looks, and it is the third time in this project that a check has asserted a
// guard is present rather than that it works.
//
// A tenanted table with no row level security policy is readable by every user.
// Nothing fails: the column is there, NOT NULL, no default, every insert sets it
// correctly, the tests above pass, the app works, and the table is visible to
// everyone. The phase 4 migrations adding `integration_credentials` (OAuth
// access and refresh tokens) and `user_integration_state` are exactly that shape
// -- they run after 0053_rls.sql, whose table list is hardcoded, so they would
// have shipped with no policy at all.
//
// drizzle/0060_rls_covers_every_tenanted_table.sql closes it structurally by
// discovering tenanted tables from the catalog rather than from a list. This
// test is what stops the discovery query from being narrowed, or a table from
// being quietly added to its exclusion list.
//
// Read against the real SQL rather than a copy of its list, so the test cannot
// agree with a stale duplicate. One source of truth, checked from the other end.

const DRIZZLE_DIR = join(__dirname, "..", "..", "..", "drizzle");
const COVERAGE_MIGRATION = "0074_rls_covers_every_tenanted_table.sql";

function readCoverageMigration(): string {
  return readFileSync(join(DRIZZLE_DIR, COVERAGE_MIGRATION), "utf8");
}

/** The `excluded text[] := ARRAY[...]` names from the coverage migration. */
function excludedTableNames(): string[] {
  const sql = readCoverageMigration();
  const match = sql.match(/excluded\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/);
  if (!match) {
    throw new Error(
      `Could not find the excluded table array in ${COVERAGE_MIGRATION}. If its shape changed, update this test rather than deleting it: it is the only thing asserting that every tenanted table is covered by a policy.`
    );
  }
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** Every drizzle table that carries a userId column, by SQL table name. */
function tablesWithUserIdColumn(): string[] {
  return Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((value) => value as PgTable)
    .filter((table) => "userId" in getTableColumns(table))
    .map((table) => getTableName(table))
    .sort();
}

describe("row level security covers every tenanted table", () => {
  it("has a coverage migration that sorts after every other migration", () => {
    // Ordering is load-bearing: both scripts/migrate.mjs and e2e/apply-rls.ts
    // apply migrations by filename order, so the coverage migration only sees
    // tables created by migrations numbered below it. A new migration that
    // creates a tenanted table and sorts above this one would leave that table
    // with no policy for a deploy.
    const migrations = readdirSync(DRIZZLE_DIR)
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort();
    const last = migrations.at(-1);

    // Actionable on purpose. This test failing is the expected outcome of adding
    // any migration, and the fix is mechanical: renumber the coverage migration
    // above the new one. It is not a reason to delete the assertion.
    expect(
      last,
      `${last} sorts after ${COVERAGE_MIGRATION}, so any tenanted table it creates would have no row level security policy until the next migration runs. Renumber ${COVERAGE_MIGRATION} above it (and update COVERAGE_MIGRATION here).`
    ).toBe(COVERAGE_MIGRATION);
  });

  it("excludes only tables that are identity rather than tenanted data", () => {
    // Every entry here is a table that will have NO policy, so the list is
    // asserted exactly rather than as a subset. Adding to it must be a
    // deliberate edit in two places, with a reviewer attached.
    expect(excludedTableNames()).toEqual(["user_identities"]);
  });

  it("does not exclude any table that holds a user's own data", () => {
    const excluded = new Set(excludedTableNames());
    const wronglyExcluded = tablesWithUserIdColumn().filter(
      (name) => excluded.has(name) && name !== "user_identities"
    );

    expect(wronglyExcluded).toEqual([]);
  });

  it("keeps 0053's hardcoded list a subset of what 0060 discovers", () => {
    // 0053_rls.sql is left in place for its reasoning, and it names its tables
    // explicitly. Two enforcement migrations can drift: a table renamed or
    // dropped later leaves a stale name in 0053 that would fail on a fresh
    // database. Every name it lists must still be a table the schema declares
    // as tenanted.
    const listed = [
      ...readFileSync(join(DRIZZLE_DIR, "0053_rls.sql"), "utf8")
        .match(/tenanted\s+text\[\]\s*:=\s*ARRAY\[([^\]]*)\]/)![1]
        .matchAll(/'([^']+)'/g),
    ].map((m) => m[1]);
    const tenanted = new Set(tablesWithUserIdColumn());

    expect(listed.filter((name) => !tenanted.has(name))).toEqual([]);
  });

  it("enforces FORCE, not merely ENABLE", () => {
    // ENABLE alone would be a no-op here: Postgres exempts a table's owner from
    // its own policies and the app connects as the owning role, so the app would
    // keep reading every user's rows while pg_tables.rowsecurity reported true.
    // A green check over a total leak. Asserted as text because this test has no
    // database; the e2e suite asserts pg_class.relforcerowsecurity for real.
    const sql = readCoverageMigration();

    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("ALTER COLUMN user_id DROP DEFAULT");
    expect(sql).toContain("WITH CHECK");
  });

  it("fails loudly if it covers nothing", () => {
    // A data-driven migration whose query stops matching would otherwise report
    // success having applied no policies at all, which is the worst outcome
    // available: no enforcement and no signal.
    expect(readCoverageMigration()).toContain("RAISE EXCEPTION");
  });
});
