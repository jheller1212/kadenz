// runGarminImport() (the Garmin pull-import path) must write the new
// provider/externalId pair alongside the legacy garminId column on every
// insert (see drizzle/0050_activity_provider_external_id.sql and
// src/lib/activity-provider.ts) — dual-write is the whole point of this
// migration staying additive.

import { describe, it, expect, vi, beforeEach } from "vitest";

const activities = { __t: "activities" } as Record<string, unknown>;
const workouts = { __t: "workouts" } as Record<string, unknown>;
const strengthSessions = { __t: "strengthSessions" } as Record<string, unknown>;
const deletedActivities = { __t: "deletedActivities" } as Record<string, unknown>;
for (const t of [activities, workouts, strengthSessions, deletedActivities]) {
  t.id = "id";
  t.stravaId = "stravaId";
  t.garminId = "garminId";
  t.startDate = "startDate";
  t.durationSeconds = "durationSeconds";
  t.gcalEventId = "gcalEventId";
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
  strengthSessions,
  deletedActivities,
  db: {
    select: () => ({ from: () => chain(selectQueue.shift() ?? []) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return { onConflictDoNothing: () => Promise.resolve(undefined) };
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
  lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
}));

vi.mock("../gcal-client", () => ({ isConnected: vi.fn().mockResolvedValue(false) }));
vi.mock("../sync-manager", () => ({ queueStrengthSessionSync: vi.fn() }));
vi.mock("../strava-client", () => ({
  findMatchingWorkout: vi.fn().mockResolvedValue(null),
  findMatchingStrengthSession: vi.fn().mockResolvedValue(null),
}));
vi.mock("../garmin-config", () => ({
  loadImportSince: vi.fn().mockResolvedValue(new Date("2026-07-01T00:00:00Z")),
  saveImportTimestamp: vi.fn().mockResolvedValue(undefined),
}));

const listActivities = vi.fn();
vi.mock("../garmin-client", () => ({
  garminClient: { listActivities },
}));

const { runGarminImport } = await import("../garmin-activity-import");

function garminRun(overrides: Record<string, unknown> = {}) {
  return {
    garminId: "999",
    kind: "run",
    name: "Morning Run",
    startTimeGMT: "2026-07-20 06:00:00",
    startTimeLocal: "2026-07-20 08:00:00",
    distanceMeters: 8000,
    durationSeconds: 2400,
    avgPaceSecPerKm: 300,
    avgHr: 140,
    maxHr: 160,
    elevationGain: 50,
    ...overrides,
  };
}

const TEST_USER_ID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  resetMockDb();
  listActivities.mockReset();
});

describe("runGarminImport — dual write", () => {
  it("writes provider/externalId alongside garminId for a run", async () => {
    listActivities.mockResolvedValue([garminRun()]);
    queueSelect([]); // tombstone check: none
    queueSelect([]); // already-imported-from-garmin check: none
    queueSelect([]); // isDuplicate: no nearby activities

    const result = await runGarminImport(TEST_USER_ID);

    expect(result.imported).toBe(1);
    const insert = insertCalls.find((c) => c.table === activities);
    expect(insert).toBeDefined();
    const values = insert!.values as Record<string, unknown>;
    expect(values.garminId).toBe("999");
    expect(values.provider).toBe("garmin");
    expect(values.externalId).toBe("999");
    // The imported activity must be filed under the user the import ran
    // for, not left to the row default (which used to attribute it to
    // whoever owns the installation).
    expect(values.userId).toBe(TEST_USER_ID);
  });

  it("writes provider/externalId alongside garminId for a strength session", async () => {
    listActivities.mockResolvedValue([
      garminRun({ kind: "strength", activityType: "WeightTraining", distanceMeters: null, avgPaceSecPerKm: null }),
    ]);
    queueSelect([]); // tombstone check: none
    queueSelect([]); // already-imported-from-garmin check: none
    queueSelect([]); // isDuplicate: no nearby activities

    const result = await runGarminImport(TEST_USER_ID);

    expect(result.imported).toBe(1);
    const insert = insertCalls.find((c) => c.table === activities);
    expect(insert).toBeDefined();
    const values = insert!.values as Record<string, unknown>;
    expect(values.garminId).toBe("999");
    expect(values.provider).toBe("garmin");
    expect(values.externalId).toBe("999");
    expect(values.userId).toBe(TEST_USER_ID);
  });
});
