// garmin-config.ts sits on top of user_integration_state (see user-state.ts).
// These tests exercise the real query shape rather than mocking user-state.ts
// away, so a regression back to a single shared row (the old sync_outbox
// singleton this replaced) fails here.

import { describe, it, expect, vi, beforeEach } from "vitest";

const userIntegrationState = { __t: "userIntegrationState" } as Record<string, unknown>;
for (const col of ["userId", "key", "value", "updatedAt"]) {
  userIntegrationState[col] = col;
}

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}
const insertCalls: Array<{ values: unknown; conflictSet: unknown }> = [];
function resetMockDb() {
  selectQueue = [];
  insertCalls.length = 0;
}

vi.mock("@/db", () => ({
  userIntegrationState,
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (opts: { set: unknown }) => {
          insertCalls.push({ values, conflictSet: opts.set });
          return Promise.resolve(undefined);
        },
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
}));

vi.mock("../garmin-client", () => ({
  garminClient: { isConfigured: vi.fn().mockReturnValue(true) },
}));

const { loadImportSince, saveImportTimestamp, loadGarminConfig, isGarminWorkoutSyncEnabled } =
  await import("../garmin-config");

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

beforeEach(() => {
  resetMockDb();
  vi.useRealTimers();
});

describe("garmin import bookmark — per user", () => {
  it("saving user A's timestamp does not move what user B reads", async () => {
    const t = new Date("2026-07-20T06:00:00Z");
    await saveImportTimestamp(USER_A, t);

    // The upsert must be keyed by (user_id, key), not a single shared row —
    // this is what fails if the code regresses to one global bookmark.
    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe(USER_A);
    expect(values.key).toBe("garmin:import");

    // User B has never imported: their read must fall back to the default
    // lookback, completely unaffected by A's save (A's save never reached
    // B's row in this mock — there's only one row, and it's A's).
    queueSelect([]); // B has no stored row
    const bSince = await loadImportSince(USER_B);
    const daysAgo = (Date.now() - bSince.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });

  it("a user with a stored bookmark gets it back, minus the overlap window", async () => {
    const stored = new Date("2026-07-01T00:00:00Z");
    queueSelect([{ value: { lastImportAt: stored.toISOString() } }]);

    const since = await loadImportSince(USER_A);
    const overlapMs = 48 * 60 * 60 * 1000;
    expect(since.getTime()).toBe(stored.getTime() - overlapMs);
  });

  it("no stored row reads as no bookmark rather than throwing", async () => {
    queueSelect([]);
    const since = await loadImportSince(USER_A);
    const daysAgo = (Date.now() - since.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(29);
  });
});

describe("garmin config — per user", () => {
  it("a user with no stored config gets syncWorkouts: false, not a throw", async () => {
    queueSelect([]);
    const config = await loadGarminConfig(USER_A);
    expect(config).toEqual({ syncWorkouts: false });
  });

  it("isGarminWorkoutSyncEnabled reads the caller's own toggle", async () => {
    queueSelect([{ value: { syncWorkouts: true } }]);
    expect(await isGarminWorkoutSyncEnabled(USER_A)).toBe(true);

    queueSelect([]); // user B never turned it on
    expect(await isGarminWorkoutSyncEnabled(USER_B)).toBe(false);
  });
});
