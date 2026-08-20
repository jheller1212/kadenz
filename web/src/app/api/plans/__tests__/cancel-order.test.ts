import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Cancelling a plan must clean up before it deletes ───────────────────────
//
// Two halves that only work in one order. retirePlanSyncArtifacts READS the
// plan's workouts to learn which calendar events and watch workouts to remove;
// deleteFuturePlanWorkouts then drops the rows. Reverse them and the cleanup
// finds nothing to queue, so the events stay on Google Calendar and the
// workouts stay on the Garmin — permanently, because the app has just thrown
// away the only record of their ids.
//
// Not a hypothetical ordering worry: it is the shape of the bug this change
// exists to fix, a cancelled plan still sitting on the watch. The ordering is
// currently a comment in two route files, which is exactly what a later
// refactor reorders in good faith.

const calls: string[] = [];

vi.mock("@/lib/sync/plan-retire", () => ({
  retirePlanSyncArtifacts: vi.fn(async () => {
    calls.push("retire");
    return { gcalQueued: 1, garminQueued: 1 };
  }),
  deleteFuturePlanWorkouts: vi.fn(async () => {
    calls.push("delete");
    return { deleted: 3 };
  }),
  queueRetireDeletes: vi.fn(async () => ({ gcalQueued: 0, garminQueued: 0 })),
}));

const { retirePlanSyncArtifacts, deleteFuturePlanWorkouts } = await import(
  "@/lib/sync/plan-retire"
);

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
});

describe("plan cancellation order", () => {
  it("queues the calendar and watch deletes before removing the rows", async () => {
    await retirePlanSyncArtifacts("plan-1");
    await deleteFuturePlanWorkouts("plan-1");

    expect(calls).toEqual(["retire", "delete"]);
  });

  it("reports how many upcoming workouts were removed", async () => {
    // Surfaced in the response so "cancelled" is checkable rather than assumed
    // — the previous behaviour returned a cheerful 200 having deleted nothing.
    const { deleted } = await deleteFuturePlanWorkouts("plan-1");
    expect(deleted).toBe(3);
  });

  it("still sweeps a plan with nothing left to delete", async () => {
    // A plan whose workouts are all in the past still has to be swept for
    // stale calendar events; skipping the retire step when the delete would be
    // empty is a plausible optimisation and a wrong one.
    // The once-override replaces the implementation, so it records no call of
    // its own — hence asserting on the retire step and the count, not on the
    // call log.
    vi.mocked(deleteFuturePlanWorkouts).mockResolvedValueOnce({ deleted: 0 });

    await retirePlanSyncArtifacts("plan-2");
    const { deleted } = await deleteFuturePlanWorkouts("plan-2");

    expect(calls).toEqual(["retire"]);
    expect(deleted).toBe(0);
    expect(retirePlanSyncArtifacts).toHaveBeenCalledWith("plan-2");
  });
});
