import { describe, expect, it } from "vitest";
import {
  estimateCurrentFitness,
  blendGoalWithCurrentFitness,
  CURRENT_FITNESS_UPLIFT_CAP,
  FITNESS_WINDOW_DAYS,
  type RunSample,
} from "../fitness-estimate";
import { calculateVdot, RACE_DISTANCES_M } from "../vdot";

const NOW = new Date("2026-07-24T00:00:00.000Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

describe("estimateCurrentFitness", () => {
  it("returns null with no runs", () => {
    expect(estimateCurrentFitness([], NOW)).toBeNull();
  });

  it("returns null when no run is close enough to a standard distance", () => {
    const runs: RunSample[] = [
      { distanceKm: 6, durationSeconds: 30 * 60, date: daysAgo(5) }, // 6km isn't within 95-115% of 5k or 10k
    ];
    expect(estimateCurrentFitness(runs, NOW)).toBeNull();
  });

  it("returns null for runs outside the recency window", () => {
    const runs: RunSample[] = [
      { distanceKm: 5, durationSeconds: 21 * 60, date: daysAgo(FITNESS_WINDOW_DAYS + 1) },
    ];
    expect(estimateCurrentFitness(runs, NOW)).toBeNull();
  });

  it("derives VDOT from a qualifying recent 10k", () => {
    const runs: RunSample[] = [
      { distanceKm: 10, durationSeconds: 45 * 60, date: daysAgo(10) },
    ];
    const estimate = estimateCurrentFitness(runs, NOW);
    expect(estimate).not.toBeNull();
    const expected = calculateVdot(RACE_DISTANCES_M["10k"], 45 * 60).vdot;
    expect(estimate!.vdot).toBeCloseTo(expected, 5);
    expect(estimate!.source.distanceKey).toBe("10k");
  });

  it("picks the fastest run within a bucket, not just the most recent", () => {
    const runs: RunSample[] = [
      { distanceKm: 5, durationSeconds: 25 * 60, date: daysAgo(5) }, // slower, more recent
      { distanceKm: 5, durationSeconds: 20 * 60, date: daysAgo(20) }, // faster
    ];
    const estimate = estimateCurrentFitness(runs, NOW);
    expect(estimate!.source.durationSeconds).toBe(20 * 60);
  });

  it("takes the highest VDOT across distance buckets", () => {
    const runs: RunSample[] = [
      { distanceKm: 5, durationSeconds: 25 * 60, date: daysAgo(5) }, // modest 5k
      { distanceKm: 10, durationSeconds: 40 * 60, date: daysAgo(15) }, // strong 10k
    ];
    const estimate = estimateCurrentFitness(runs, NOW);
    expect(estimate!.source.distanceKey).toBe("10k");
  });

  it("ignores runs well short of any standard distance", () => {
    const runs: RunSample[] = [
      { distanceKm: 2, durationSeconds: 10 * 60, date: daysAgo(2) },
    ];
    expect(estimateCurrentFitness(runs, NOW)).toBeNull();
  });
});

describe("blendGoalWithCurrentFitness", () => {
  it("returns the goal VDOT unchanged when there's no current-fitness estimate", () => {
    expect(blendGoalWithCurrentFitness(50, null)).toBe(50);
    expect(blendGoalWithCurrentFitness(50, undefined)).toBe(50);
  });

  it("trusts a conservative goal (below current fitness) as-is", () => {
    expect(blendGoalWithCurrentFitness(40, 50)).toBe(40);
  });

  it("caps an aggressive goal at current fitness plus the uplift cap", () => {
    const currentVdot = 40;
    const aggressiveGoalVdot = 60;
    const result = blendGoalWithCurrentFitness(aggressiveGoalVdot, currentVdot);
    expect(result).toBeCloseTo(currentVdot * (1 + CURRENT_FITNESS_UPLIFT_CAP), 5);
    expect(result).toBeLessThan(aggressiveGoalVdot);
  });

  it("passes a goal through unchanged when it's within the uplift cap of current fitness", () => {
    const currentVdot = 40;
    const modestGoalVdot = currentVdot * 1.03; // within the 8% cap
    expect(blendGoalWithCurrentFitness(modestGoalVdot, currentVdot)).toBeCloseTo(
      modestGoalVdot,
      5
    );
  });
});
