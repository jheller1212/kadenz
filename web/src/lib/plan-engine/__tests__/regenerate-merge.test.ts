import { describe, expect, it } from "vitest";
import { isPreservedWorkout, planRegenerateMerge } from "../regenerate-merge";

describe("planRegenerateMerge", () => {
  it("retains no weeks and inserts every generated week when nothing is preserved", () => {
    const result = planRegenerateMerge([], [1, 2, 3]);
    expect(result.retainedWeekNumbers.size).toBe(0);
    expect(result.weekNumbersToInsert).toEqual([1, 2, 3]);
    expect(result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-05") })).toBe(
      true
    );
  });

  it("retains a week that holds a preserved (completed/skipped/missed) workout", () => {
    const preserved = [{ weekNumber: 2, date: new Date("2026-01-13T00:00:00.000Z") }];
    const result = planRegenerateMerge(preserved, [1, 2, 3]);
    expect(result.retainedWeekNumbers).toEqual(new Set([2]));
    expect(result.weekNumbersToInsert).toEqual([1, 3]);
  });

  it("drops a generated workout landing on the same date as a preserved workout", () => {
    const preserved = [{ weekNumber: 2, date: new Date("2026-01-13T09:00:00.000Z") }];
    const result = planRegenerateMerge(preserved, [1, 2, 3]);

    // Same calendar day, different time of day — still a collision.
    expect(
      result.keepGeneratedWorkout({ weekNumber: 2, date: new Date("2026-01-13T18:30:00.000Z") })
    ).toBe(false);

    // A different day in the same week is unaffected.
    expect(
      result.keepGeneratedWorkout({ weekNumber: 2, date: new Date("2026-01-14T09:00:00.000Z") })
    ).toBe(true);
  });

  it("keeps a preserved workout's week even when the new schedule has no week at that number", () => {
    // Plan shortened: new schedule only generates 2 weeks, but week 5 held a
    // completed run. Week 5 must not be touched — it simply isn't part of
    // weekNumbersToInsert (nothing to insert there) and isn't deleted either.
    const preserved = [{ weekNumber: 5, date: new Date("2026-02-10T00:00:00.000Z") }];
    const result = planRegenerateMerge(preserved, [1, 2]);
    expect(result.retainedWeekNumbers).toEqual(new Set([5]));
    expect(result.weekNumbersToInsert).toEqual([1, 2]);
  });

  it("handles multiple preserved workouts across multiple weeks", () => {
    const preserved = [
      { weekNumber: 1, date: new Date("2026-01-05T00:00:00.000Z") },
      { weekNumber: 1, date: new Date("2026-01-07T00:00:00.000Z") },
      { weekNumber: 2, date: new Date("2026-01-12T00:00:00.000Z") },
    ];
    const result = planRegenerateMerge(preserved, [1, 2, 3]);
    expect(result.retainedWeekNumbers).toEqual(new Set([1, 2]));
    expect(result.weekNumbersToInsert).toEqual([3]);
    expect(
      result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-05T12:00:00.000Z") })
    ).toBe(false);
    expect(
      result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-06T00:00:00.000Z") })
    ).toBe(true);
  });
});

describe("isPreservedWorkout", () => {
  it("preserves a hand-tuned (edited) planned workout", () => {
    expect(isPreservedWorkout({ status: "planned", edited: true, timeOfDay: null })).toBe(true);
  });

  it("preserves a planned workout with a start time set", () => {
    expect(isPreservedWorkout({ status: "planned", edited: false, timeOfDay: "07:00" })).toBe(
      true
    );
  });

  it("preserves a completed/skipped/missed workout regardless of edited/timeOfDay", () => {
    expect(isPreservedWorkout({ status: "completed", edited: false, timeOfDay: null })).toBe(
      true
    );
  });

  it("does not preserve an untouched planned workout", () => {
    expect(isPreservedWorkout({ status: "planned", edited: false, timeOfDay: null })).toBe(
      false
    );
  });
});

describe("planRegenerateMerge with hand-edited/timed workouts", () => {
  it("survives a regenerate for an edited workout and an untouched one is regenerated", () => {
    // Simulates what PUT /api/plans/[id] does: it queries for workouts that
    // are `isPreservedWorkout`, and only those become `preserved` refs here.
    const rows = [
      { weekNumber: 1, date: new Date("2026-01-05T00:00:00.000Z"), status: "planned", edited: true, timeOfDay: null },
      { weekNumber: 1, date: new Date("2026-01-06T00:00:00.000Z"), status: "planned", edited: false, timeOfDay: "07:00" },
      { weekNumber: 1, date: new Date("2026-01-07T00:00:00.000Z"), status: "planned", edited: false, timeOfDay: null },
    ];
    const preserved = rows.filter(isPreservedWorkout);
    const result = planRegenerateMerge(preserved, [1, 2]);

    // Both the edited workout and the timed workout keep their week and
    // block a freshly generated workout from double-booking their day.
    expect(result.retainedWeekNumbers).toEqual(new Set([1]));
    expect(
      result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-05T12:00:00.000Z") })
    ).toBe(false);
    expect(
      result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-06T18:00:00.000Z") })
    ).toBe(false);

    // The untouched planned workout was never in `preserved`, so its day is
    // free for the regenerated schedule to fill.
    expect(
      result.keepGeneratedWorkout({ weekNumber: 1, date: new Date("2026-01-07T00:00:00.000Z") })
    ).toBe(true);
  });
});
