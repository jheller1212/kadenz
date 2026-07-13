import { describe, expect, it } from "vitest";
import { estimateWorkoutDuration } from "../estimate";

describe("estimateWorkoutDuration", () => {
  it("returns 0 for an empty workout", () => {
    expect(estimateWorkoutDuration([])).toBe(0);
  });

  it("estimates a single slot: setup + reps + rest between sets", () => {
    // 3 sets × (15 + 10×2) = 105s work + 2×90 = 180s rest → 285s → 5 min
    expect(
      estimateWorkoutDuration([
        { sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 },
      ])
    ).toBe(5);
  });

  it("does not count rest after the final set", () => {
    // 1 set × (15 + 10×2) = 35s, no rest → 1 min
    expect(
      estimateWorkoutDuration([
        { sets: 1, repLow: 10, repHigh: 10, restSeconds: 600 },
      ])
    ).toBe(1);
  });

  it("sums across slots and rounds up", () => {
    const slot = { sets: 3, repLow: 8, repHigh: 12, restSeconds: 90 };
    expect(estimateWorkoutDuration([slot, slot])).toBe(10);
  });
});
