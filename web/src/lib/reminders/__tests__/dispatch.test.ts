// Same mocking convention as garmin-activity-import.test.ts: vi.mock("@/db")
// with opaque table tags, module under test loaded via dynamic import so it
// resolves after the mocks below are wired up. due.ts/retry.ts are pure and
// deliberately NOT mocked — this exercises the real "is it due" decision
// against per-user data.

import { describe, it, expect, vi, beforeEach } from "vitest";

const workouts = { __t: "workouts" } as Record<string, unknown>;
const sentReminders = { __t: "sentReminders" } as Record<string, unknown>;
for (const col of ["id", "title", "date", "timeOfDay", "status", "workoutId", "userId"]) {
  workouts[col] = col;
}
for (const col of ["id", "workoutId", "status", "attempts", "lastAttemptAt", "userId"]) {
  sentReminders[col] = col;
}

let selectQueue: unknown[][] = [];
function queueSelect(rows: unknown[]) {
  selectQueue.push(rows);
}
const insertValuesCalls: Array<Record<string, unknown>> = [];
let insertReturningQueue: Array<Array<{ id: string }>> = [];
const updateSetCalls: Array<Record<string, unknown>> = [];

function resetMockDb() {
  selectQueue = [];
  insertValuesCalls.length = 0;
  insertReturningQueue = [];
  updateSetCalls.length = 0;
}

// Candidate workouts come back through the relational query API
// (db.query.workouts.findMany), not db.select, because dispatch needs each
// workout's blocks to rebuild the title in the athlete's own units.
const findMany = vi.fn();

vi.mock("@/db", () => ({
  workouts,
  sentReminders,
  db: {
    query: { workouts: { findMany } },
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectQueue.shift() ?? []),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValuesCalls.push(values);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(insertReturningQueue.shift() ?? []),
          }),
        };
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => {
        updateSetCalls.push(set);
        // Awaitable directly (the final status write has no .returning()
        // call) but also chainable through .returning() (the reclaim path
        // does) — a real Promise supports both since it's just an object.
        const p = Promise.resolve(undefined) as Promise<unknown> & {
          where: (w: unknown) => Promise<unknown> & { returning: () => Promise<unknown[]> };
        };
        p.where = () =>
          Object.assign(Promise.resolve(undefined), {
            returning: () => Promise.resolve([]),
          });
        return p;
      },
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  gte: (a: unknown, b: unknown) => ({ op: "gte", a, b }),
  lte: (a: unknown, b: unknown) => ({ op: "lte", a, b }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
  // Never called from dispatch, but schema.ts evaluates relations() at import
  // time and the @/db mock above does not stop it being loaded transitively.
  relations: () => ({}),
}));

// The loop is driven by the users who have reminders switched ON, which is one
// indexed read rather than "every user, then load each config".
const listEnabledReminderConfigs = vi.fn();
vi.mock("../settings", () => ({ listEnabledReminderConfigs }));

// Reminder titles are rebuilt server-side in the athlete's own units.
vi.mock("@/lib/user-units", () => ({
  loadUserUnits: vi.fn().mockResolvedValue({ distanceUnit: "km", weightUnit: "kg" }),
}));

const listSubscriptions = vi.fn();
const removeExpiredSubscriptions = vi.fn();
vi.mock("../subscriptions", () => ({ listSubscriptions, removeExpiredSubscriptions }));

const sendToSubscription = vi.fn();
vi.mock("../push", () => ({ sendToSubscription }));

const { dispatchDueReminders } = await import("../dispatch");

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";

// Local noon in Europe/Amsterdam (CEST, +2) on 2026-07-20 is 10:00 UTC.
// A workout with time_of_day 12:15 and the default 30-minute lead is due
// starting 09:45 UTC — "now" below sits right in that window.
const NOW = new Date("2026-07-20T10:00:00Z");
const CONFIG = { enabled: true, leadMinutes: 30, defaultTimeOfDay: "07:00" };

function dueWorkout(id: string, title: string) {
  return {
    id,
    title,
    date: new Date("2026-07-20T08:00:00Z"),
    timeOfDay: "12:15",
    status: "planned" as const,
    type: "easy",
    targetKm: 8,
    blocks: [],
  };
}

beforeEach(() => {
  resetMockDb();
  findMany.mockReset();
  listEnabledReminderConfigs.mockReset();
  listSubscriptions.mockReset();
  removeExpiredSubscriptions.mockReset().mockResolvedValue(undefined);
  sendToSubscription.mockReset();
});

describe("dispatchDueReminders", () => {
  it("sends a user's reminder only to that user's own devices", async () => {
    listEnabledReminderConfigs.mockResolvedValue([
      { userId: USER_A, config: CONFIG },
      { userId: USER_B, config: CONFIG },
    ]);

    const subsByUser: Record<string, Array<{ endpoint: string; p256dh: string; auth: string }>> = {
      [USER_A]: [{ endpoint: "https://push.example/a-phone", p256dh: "kA", auth: "aA" }],
      [USER_B]: [{ endpoint: "https://push.example/b-phone", p256dh: "kB", auth: "aB" }],
    };
    listSubscriptions.mockImplementation((userId: string) => Promise.resolve(subsByUser[userId] ?? []));
    sendToSubscription.mockResolvedValue({ ok: true, expired: false });

    // One findMany per user (their own candidate workouts), then one select
    // per user for existing sent_reminders claims.
    findMany
      .mockResolvedValueOnce([dueWorkout("workout-a", "A's long run")])
      .mockResolvedValueOnce([dueWorkout("workout-b", "B's easy run")]);
    queueSelect([]); // A: no existing sent_reminders claim
    queueSelect([]); // B: no existing sent_reminders claim
    insertReturningQueue = [[{ id: "claim-a" }], [{ id: "claim-b" }]];

    const result = await dispatchDueReminders(NOW);

    expect(result.sent).toBe(2);
    expect(sendToSubscription).toHaveBeenCalledTimes(2);

    // A's push went only to A's endpoint, B's only to B's.
    const endpointsCalled = sendToSubscription.mock.calls.map((c) => c[0].endpoint);
    expect(endpointsCalled).toEqual([
      "https://push.example/a-phone",
      "https://push.example/b-phone",
    ]);

    // Each claim was filed under its own user.
    expect(insertValuesCalls.map((v) => v.userId)).toEqual([USER_A, USER_B]);
  });

  it("continues to the next user when one user's dispatch throws", async () => {
    listEnabledReminderConfigs.mockResolvedValue([
      { userId: USER_A, config: CONFIG },
      { userId: USER_B, config: CONFIG },
    ]);
    // A's device lookup blows up (a database blip scoped to one user). B must
    // still get dispatched rather than being skipped behind A's failure.
    listSubscriptions.mockImplementation((userId: string) =>
      userId === USER_A
        ? Promise.reject(new Error("boom"))
        : Promise.resolve([
            { endpoint: "https://push.example/b-phone", p256dh: "kB", auth: "aB" },
          ])
    );
    sendToSubscription.mockResolvedValue({ ok: true, expired: false });

    findMany.mockResolvedValue([dueWorkout("workout-b", "B's easy run")]);
    queueSelect([]); // B: no existing claim
    insertReturningQueue = [[{ id: "claim-b" }]];

    const result = await dispatchDueReminders(NOW);

    expect(result.sent).toBe(1);
    expect(result.errors).toBeGreaterThanOrEqual(1); // A's failure is counted, not swallowed silently
    expect(sendToSubscription).toHaveBeenCalledTimes(1);
    expect(sendToSubscription.mock.calls[0][0].endpoint).toBe("https://push.example/b-phone");
  });
});
