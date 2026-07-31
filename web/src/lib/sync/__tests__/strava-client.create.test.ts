// processActivity() (the Strava webhook/backfill "create" path) must write
// the new provider/externalId pair alongside the legacy stravaId column on
// every insert (see drizzle/0050_activity_provider_external_id.sql and
// src/lib/activity-provider.ts) — dual-write is the whole point of this
// migration staying additive. Same mocking approach as
// strava-client.update-delete.test.ts (opaque table tags, scripted selects,
// no real DB).

import { describe, it, expect, vi, beforeEach } from "vitest";

const activities = { __t: "activities" } as Record<string, unknown>;
const workouts = { __t: "workouts" } as Record<string, unknown>;
const plans = { __t: "plans" } as Record<string, unknown>;
const strengthSessions = { __t: "strengthSessions" } as Record<string, unknown>;
const strengthSets = { __t: "strengthSets" } as Record<string, unknown>;
const deletedActivities = { __t: "deletedActivities" } as Record<string, unknown>;
const activityTrash = { __t: "activityTrash" } as Record<string, unknown>;
const syncOutbox = { __t: "syncOutbox" } as Record<string, unknown>;
// strava-client's loadTokens/saveTokens go through lib/sync/credentials.ts
// (not mocked here, it's the real module), which reads/writes this table.
// It needs the same opaque-tag treatment as everything else the mocked "@/db"
// stands in for, or `integrationCredentials.userId` throws on an undefined
// export and loadCredentials' catch quietly turns that into "not connected".
const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
for (const t of [activities, workouts, plans, strengthSessions, strengthSets, deletedActivities, activityTrash, syncOutbox, integrationCredentials]) {
  t.id = "id";
  t.stravaId = "stravaId";
  t.workoutId = "workoutId";
  t.status = "status";
  t.targetKm = "targetKm";
  t.planId = "planId";
  t.date = "date";
  t.type = "type";
  t.startDate = "startDate";
  t.durationSeconds = "durationSeconds";
  t.payload = "payload";
  t.idempotencyKey = "idempotencyKey";
  t.userId = "userId";
  t.provider = "provider";
}

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

const insertCalls: Array<{ table: unknown; values: unknown }> = [];

function resetMockDb() {
  selectQueue = [];
  insertCalls.length = 0;
}

function chain(resolveTo: unknown) {
  const c: Record<string, unknown> = {
    from: () => c,
    innerJoin: () => c,
    where: () => c,
    limit: () => Promise.resolve(resolveTo),
    then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(resolveTo).then(onFulfilled),
    catch: (onRejected: (e: unknown) => unknown) => Promise.resolve(resolveTo).catch(onRejected),
  };
  return c;
}

vi.mock("@/db", () => ({
  activities,
  workouts,
  plans,
  strengthSessions,
  strengthSets,
  deletedActivities,
  activityTrash,
  syncOutbox,
  integrationCredentials,
  db: {
    select: () => ({
      from: () => chain(selectQueue.shift() ?? []),
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return { onConflictDoNothing: () => Promise.resolve(undefined) };
      },
    }),
    delete: () => ({ where: () => Promise.resolve(undefined) }),
  },
}));

// Spread the real module rather than listing exports. An exhaustive mock has to
// be updated whenever anything anywhere in the imported module graph starts
// using a different drizzle export: this one broke on `relations`, which
// db/schema.ts uses and this file never mentions. The operators below are still
// stubbed, because the assertions match on their plain shapes.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
  lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
  ne: (a: unknown, b: unknown) => ({ op: "ne", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
}));

vi.mock("@/lib/sync/gcal-client", () => ({ isConnected: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/sync/sync-manager", () => ({ queueStrengthSessionSync: vi.fn() }));

const { processActivity } = await import("../strava-client");

const USER_ID = "11111111-1111-4111-8111-111111111111";

const TOKEN_ROW = [
  {
    payload: {
      access_token: "at",
      refresh_token: "rt",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      athlete_id: 1,
    },
  },
];

function stravaActivityPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 555,
    name: "Evening Run",
    type: "Run",
    sport_type: "Run",
    distance: 10000,
    moving_time: 3000,
    elapsed_time: 3050,
    start_date: "2026-07-20T17:00:00Z",
    start_date_local: "2026-07-20T19:00:00Z",
    average_speed: 3.33,
    max_speed: 4.0,
    ...overrides,
  };
}

beforeEach(() => {
  resetMockDb();
  global.fetch = vi.fn();
});

describe("processActivity — dual write", () => {
  it("writes provider/externalId alongside stravaId for a run", async () => {
    queueSelect([]); // tombstone check: none
    queueSelect([]); // existing-row check: none found
    queueSelect(TOKEN_ROW); // loadTokens for fetchActivity()
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => stravaActivityPayload(),
    });
    queueSelect([]); // isDuplicateOfExisting: no nearby activities
    queueSelect([]); // findMatchingWorkout: no candidates → null, no match

    const result = await processActivity(USER_ID, 555);

    expect(result).toBe("stored");
    const insert = insertCalls.find((c) => c.table === activities);
    expect(insert).toBeDefined();
    const values = insert!.values as Record<string, unknown>;
    expect(values.stravaId).toBe("555");
    expect(values.provider).toBe("strava");
    expect(values.externalId).toBe("555");
    expect(values.userId).toBe(USER_ID);
  });

  it("writes provider/externalId alongside stravaId for a strength session", async () => {
    queueSelect([]); // tombstone check: none
    queueSelect([]); // existing-row check: none found
    queueSelect(TOKEN_ROW); // loadTokens for fetchActivity()
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () =>
        stravaActivityPayload({
          type: "WeightTraining",
          sport_type: "WeightTraining",
          moving_time: 400, // >= MIN_STRENGTH_MATCH_SECONDS
        }),
    });
    queueSelect([]); // isDuplicateOfExisting: no nearby activities
    queueSelect([]); // findMatchingStrengthSession: no candidates → null

    const result = await processActivity(USER_ID, 555);

    expect(result).toBe("stored");
    const insert = insertCalls.find((c) => c.table === activities);
    expect(insert).toBeDefined();
    const values = insert!.values as Record<string, unknown>;
    expect(values.stravaId).toBe("555");
    expect(values.provider).toBe("strava");
    expect(values.externalId).toBe("555");
    expect(values.userId).toBe(USER_ID);
  });
});
