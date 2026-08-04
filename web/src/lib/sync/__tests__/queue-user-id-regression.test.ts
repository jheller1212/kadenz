// Regression coverage for a production incident: queueWorkoutSync's fourth
// parameter (`target`, "gcal" | "garmin") and queuePlanWorkoutsSync's third
// parameter used to sit right next to a plain `userId: string`, so a call
// site that forgot the userId argument — `queueWorkoutSync(workoutId,
// "update", "gcal")`, `queuePlanWorkoutsSync(planId, "gcal")` — type-checked
// cleanly with the literal "gcal" landing in `userId`. Every insert into
// sync_outbox then carried user_id: 'gcal', which Postgres rejects
// (`invalid input syntax for type uuid`), and because it happened inside a
// transaction the entire request's transaction aborted with it — turning a
// broken calendar sync into a failure to complete a workout at all.
//
// THE PRIMARY GUARD IS THE TYPE, NOT THIS TEST. `userId` on every queue*
// export in this file is now the branded `UserId` (see lib/user-id.ts), not
// `string`. A plain string constant like "gcal" is not assignable to it, so
// `queueWorkoutSync(workoutId, "update", "gcal")` and
// `queuePlanWorkoutsSync(planId, "gcal")` are compile errors — the exact
// call sites that broke production. This suite passed the whole time that
// bug was live in production (it only ever exercised correct call sites), so
// it cannot be the thing that catches a regression back to `userId: string`;
// it only documents, at runtime, what a well-typed call now does: write the
// caller's real user id into the row, scoped to that user.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { asUserId } from "@/lib/user-id";

const OWNER = asUserId("00000000-0000-0000-0000-000000000001");
const OTHER = asUserId("22222222-2222-4222-8222-222222222222");

type InsertedRow = Record<string, unknown>;
const insertedRows: InsertedRow[] = [];

vi.mock("@/db/with-user", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/with-user")>();
  return { ...actual };
});

vi.mock("@/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db")>();
  const chain = {
    values: vi.fn((rows: InsertedRow | InsertedRow[]) => {
      const arr = Array.isArray(rows) ? rows : [rows];
      insertedRows.push(...arr);
      return chain;
    }),
    onConflictDoUpdate: vi.fn(() => Promise.resolve()),
    onConflictDoNothing: vi.fn(() => Promise.resolve()),
  };
  return {
    ...actual,
    db: {
      ...actual.db,
      insert: vi.fn(() => chain),
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{ id: "workout-1" }])),
        })),
      })),
    },
  };
});

// processGCalOutbox is a fire-and-forget follow-up (not the thing under
// test here) — stubbed so queueing doesn't try to open a real drain.
vi.mock("../gcal-client", () => ({
  createEvent: vi.fn(),
  patchEvent: vi.fn(),
  deleteEvent: vi.fn(),
  createStrengthEvent: vi.fn(),
  patchStrengthEvent: vi.fn(),
}));

const { queueWorkoutSync, queuePlanWorkoutsSync, queueStrengthSessionSync } =
  await import("../sync-manager");

beforeEach(() => {
  vi.clearAllMocks();
  insertedRows.length = 0;
});

describe("queue* user id regression", () => {
  it("queueWorkoutSync writes the caller's real user id, not a target/action string", async () => {
    await queueWorkoutSync("workout-1", "update", OWNER, "gcal");

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].userId).toBe(OWNER);
    expect(insertedRows[0].userId).not.toBe("gcal");
  });

  it("queuePlanWorkoutsSync scopes every queued row to the caller's user id", async () => {
    await queuePlanWorkoutsSync("plan-1", OWNER, "gcal");

    expect(insertedRows.length).toBeGreaterThan(0);
    for (const row of insertedRows) {
      expect(row.userId).toBe(OWNER);
      expect(row.userId).not.toBe("gcal");
    }
  });

  it("queueStrengthSessionSync writes the caller's real user id, not the target string", async () => {
    await queueStrengthSessionSync("session-1", "delete", OWNER, "gcal", {
      gcalEventId: "evt-1",
    });

    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].userId).toBe(OWNER);
  });

  it("two different callers' rows never collide on the same user id", async () => {
    await queueWorkoutSync("workout-1", "update", OWNER, "gcal");
    await queueWorkoutSync("workout-1", "update", OTHER, "garmin");

    expect(insertedRows).toHaveLength(2);
    expect(insertedRows[0].userId).toBe(OWNER);
    expect(insertedRows[1].userId).toBe(OTHER);
    expect(insertedRows[0].userId).not.toBe(insertedRows[1].userId);
  });
});
