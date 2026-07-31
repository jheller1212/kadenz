// Same mocking convention as garmin-activity-import.test.ts: vi.mock("@/db")
// with an opaque table tag, and the module under test loaded via dynamic
// import so it resolves after the mock factories below are in place.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { asUserId } from "@/lib/user-id";

const pushSubscriptions = { __t: "pushSubscriptions" } as Record<string, unknown>;
for (const col of ["endpoint", "p256dh", "auth", "userId"]) {
  pushSubscriptions[col] = col;
}

const insertCalls: Array<{ values: unknown; conflictSet: unknown }> = [];
const deleteCalls: Array<{ where: unknown }> = [];
function resetMockDb() {
  insertCalls.length = 0;
  deleteCalls.length = 0;
}

vi.mock("@/db", () => ({
  pushSubscriptions,
  db: {
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (opts: { set: unknown }) => {
          insertCalls.push({ values, conflictSet: opts.set });
          return Promise.resolve(undefined);
        },
      }),
    }),
    delete: () => ({
      where: (where: unknown) => {
        deleteCalls.push({ where });
        return Promise.resolve(undefined);
      },
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve([]),
      }),
    }),
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...args: unknown[]) => ({ op: "and", args }),
  inArray: (a: unknown, b: unknown) => ({ op: "inArray", a, b }),
}));

const { saveSubscription } = await import("../subscriptions");

beforeEach(() => {
  resetMockDb();
});

describe("saveSubscription", () => {
  const USER_A = asUserId("aaaaaaaa-0000-0000-0000-000000000001");
  const USER_B = asUserId("bbbbbbbb-0000-0000-0000-000000000002");
  const sub = { endpoint: "https://push.example/ep1", p256dh: "key1", auth: "auth1" };

  it("files the row against the userId passed in", async () => {
    await saveSubscription(USER_A, sub);

    expect(insertCalls).toHaveLength(1);
    const values = insertCalls[0].values as Record<string, unknown>;
    expect(values.userId).toBe(USER_A);
    expect(values.endpoint).toBe(sub.endpoint);
  });

  it("reassigns ownership to whoever most recently subscribed on conflict", async () => {
    // Same browser profile, first athlete A subscribes...
    await saveSubscription(USER_A, sub);
    // ...then signs out and athlete B signs in on the same device/browser and
    // subscribes again. The endpoint is unique table-wide, so this is the
    // conflict path, and it must hand the row to B — leaving it on A would
    // mean B's device keeps delivering A's workout reminders.
    await saveSubscription(USER_B, sub);

    expect(insertCalls).toHaveLength(2);
    const secondConflictSet = insertCalls[1].conflictSet as Record<string, unknown>;
    expect(secondConflictSet.userId).toBe(USER_B);
  });
});
