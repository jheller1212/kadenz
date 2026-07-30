// Orchestration tests for updateActivity() / deleteStravaActivity() — the
// Strava webhook's "update" and "delete" handlers. The field-mapping logic
// itself (which columns follow Strava) is tested separately, DB-free, in
// strava-activity-fields.test.ts; this file only exercises the decisions
// that touch the database: no-op vs. write, and soft- vs. hard-delete.
//
// "@/db" is fully mocked — table exports are opaque identity tags (not real
// drizzle Column objects), and drizzle-orm's condition builders (eq, and,
// …) are mocked to pass their raw args through unevaluated. Nothing here
// asserts on WHERE-clause SQL; it asserts on which table each call targeted
// and what values were written, which is what these behaviours are about.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Fake schema: each table is just a unique tag object ─────────────────────
const activities = { __t: "activities" } as Record<string, unknown>;
const syncOutbox = { __t: "syncOutbox" } as Record<string, unknown>;
const workouts = { __t: "workouts" } as Record<string, unknown>;
const strengthSessions = { __t: "strengthSessions" } as Record<string, unknown>;
const deletedActivities = { __t: "deletedActivities" } as Record<string, unknown>;
const activityTrash = { __t: "activityTrash" } as Record<string, unknown>;
const plans = { __t: "plans" } as Record<string, unknown>;
// strava-client's loadTokens/saveTokens go through lib/sync/credentials.ts
// (not mocked here, it's the real module), which reads/writes this table.
// It needs the same opaque-tag treatment as everything else the mocked "@/db"
// stands in for, or `integrationCredentials.userId` throws on an undefined
// export and loadCredentials' catch quietly turns that into "not connected".
const integrationCredentials = { __t: "integrationCredentials" } as Record<string, unknown>;
// strava-client.ts destructures column props off these (e.g. activities.stravaId)
// for select projections — any value works since conditions aren't evaluated.
for (const t of [activities, syncOutbox, workouts, strengthSessions, deletedActivities, activityTrash, plans, integrationCredentials]) {
  t.stravaId = "stravaId";
  t.id = "id";
  t.workoutId = "workoutId";
  t.strengthSessionId = "strengthSessionId";
  t.gcalEventId = "gcalEventId";
  t.payload = "payload";
  t.idempotencyKey = "idempotencyKey";
  t.userId = "userId";
  t.provider = "provider";
}

// ── Scripted select results, consumed FIFO, one entry per db.select() call ──
let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}

const updateCalls: Array<{ table: unknown; set: unknown }> = [];
const insertCalls: Array<{ table: unknown; values: unknown }> = [];
const deleteCalls: Array<{ table: unknown }> = [];

function resetMockDb() {
  selectQueue = [];
  updateCalls.length = 0;
  insertCalls.length = 0;
  deleteCalls.length = 0;
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
  syncOutbox,
  workouts,
  strengthSessions,
  deletedActivities,
  activityTrash,
  plans,
  integrationCredentials,
  db: {
    select: () => ({
      from: () => chain(selectQueue.shift() ?? []),
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => {
        updateCalls.push({ table, set });
        return { where: () => Promise.resolve(undefined) };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return {
          onConflictDoNothing: () => Promise.resolve(undefined),
          onConflictDoUpdate: () => Promise.resolve(undefined),
        };
      },
    }),
    delete: (table: unknown) => {
      deleteCalls.push({ table });
      return { where: () => Promise.resolve(undefined) };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
  lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
  ne: (a: unknown, b: unknown) => ({ op: "ne", a, b }),
  isNull: (a: unknown) => ({ op: "isNull", a }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
}));

// gcal-client / sync-manager aren't exercised by update/delete — stub them out
// so importing strava-client.ts doesn't pull in unrelated modules.
vi.mock("@/lib/sync/gcal-client", () => ({ isConnected: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/sync/sync-manager", () => ({ queueStrengthSessionSync: vi.fn() }));

const { updateActivity, deleteStravaActivity } = await import("../strava-client");

const USER_ID = "11111111-1111-4111-8111-111111111111";

// A minimal valid Strava token, expiring far in the future so getAccessToken()
// never tries to refresh (which would need another fetch + db write).
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

describe("updateActivity", () => {
  it("is a safe no-op for an unknown Strava id — never creates a row", async () => {
    queueSelect([]); // tombstone check: none
    queueSelect([]); // existing-row check: none found
    const result = await updateActivity(USER_ID, 999);
    expect(result).toBe("not_found");
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("does not resurrect a trashed (tombstoned) activity", async () => {
    queueSelect([{ stravaId: "555" }]); // tombstone check: found
    const result = await updateActivity(USER_ID, 555);
    expect(result).toBe("trashed");
    expect(insertCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("refreshes the title (and other Strava-sourced fields) on a known activity", async () => {
    queueSelect([]); // tombstone check: none
    queueSelect([{ id: "row-1" }]); // existing-row check: found
    queueSelect(TOKEN_ROW); // getAccessToken -> loadTokens

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => stravaActivityPayload({ name: "Evening Run (fixed)" }),
    });

    const result = await updateActivity(USER_ID, 555);
    expect(result).toBe("updated");
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe(activities);
    const patch = updateCalls[0].set as Record<string, unknown>;
    expect(patch.name).toBe("Evening Run (fixed)");
    expect(patch.distanceKm).toBeCloseTo(10);
    expect(patch.durationSeconds).toBe(3000);
  });

  it("never writes workoutId, strengthSessionId, id, or aiInsight — Kadenz-side fields", async () => {
    queueSelect([]);
    queueSelect([{ id: "row-1" }]);
    queueSelect(TOKEN_ROW);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => stravaActivityPayload(),
    });

    await updateActivity(USER_ID, 555);
    const patch = updateCalls[0].set as Record<string, unknown>;
    expect(patch).not.toHaveProperty("workoutId");
    expect(patch).not.toHaveProperty("strengthSessionId");
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("aiInsight");
    expect(patch).not.toHaveProperty("aiInsightGeneratedAt");
    expect(patch).not.toHaveProperty("streamsJson");
    expect(patch).not.toHaveProperty("stravaId");
    expect(patch).not.toHaveProperty("createdAt");
  });

  it("leaves run-specific fields alone when the activity is no longer a Run", async () => {
    queueSelect([]);
    queueSelect([{ id: "row-1" }]);
    queueSelect(TOKEN_ROW);
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => stravaActivityPayload({ type: "Hike", sport_type: "Hike" }),
    });

    await updateActivity(USER_ID, 555);
    const patch = updateCalls[0].set as Record<string, unknown>;
    expect(patch.name).toBe("Evening Run");
    expect(patch.sportType).toBe("Hike");
    expect(patch).not.toHaveProperty("distanceKm");
    expect(patch).not.toHaveProperty("polyline");
  });
});

describe("deleteStravaActivity", () => {
  it("soft-deletes: writes to activityTrash and deletedActivities, never hard-deletes without a trash row", async () => {
    queueSelect([
      {
        id: "row-1",
        stravaId: "555",
        workoutId: null,
        strengthSessionId: null,
        name: "Evening Run",
      },
    ]);

    const result = await deleteStravaActivity(USER_ID, 555);
    expect(result).toBe("trashed");

    const trashInsert = insertCalls.find((c) => c.table === activityTrash);
    expect(trashInsert).toBeDefined();
    expect((trashInsert!.values as Record<string, unknown>).userId).toBe(USER_ID);
    const tombstoneInsert = insertCalls.find((c) => c.table === deletedActivities);
    expect(tombstoneInsert).toBeDefined();
    expect((tombstoneInsert!.values as Record<string, unknown>).userId).toBe(USER_ID);

    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0].table).toBe(activities);
  });

  it("is a safe no-op when the activity was never imported or is already trashed", async () => {
    queueSelect([]); // no row found
    const result = await deleteStravaActivity(USER_ID, 999);
    expect(result).toBe("not_found");
    expect(insertCalls).toHaveLength(0);
    expect(deleteCalls).toHaveLength(0);
  });

  it("reverts a linked workout to planned rather than leaving it completed by a deleted activity", async () => {
    queueSelect([
      {
        id: "row-1",
        stravaId: "555",
        workoutId: "workout-1",
        strengthSessionId: null,
        name: "Evening Run",
      },
    ]);

    await deleteStravaActivity(USER_ID, 555);
    const workoutUpdate = updateCalls.find((c) => c.table === workouts);
    expect(workoutUpdate).toBeDefined();
    expect((workoutUpdate!.set as Record<string, unknown>).status).toBe("planned");
  });
});
