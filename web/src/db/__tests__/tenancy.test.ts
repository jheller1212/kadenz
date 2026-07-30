import { getTableColumns, is } from "drizzle-orm";
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
