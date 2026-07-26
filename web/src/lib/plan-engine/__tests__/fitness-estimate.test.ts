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

describe("estimateCurrentFitness with a race result", () => {
  it("prefers a recent race result over a faster training run", () => {
    const runs: RunSample[] = [
      // A much faster training 10k that would otherwise win on VDOT alone.
      { distanceKm: 10, durationSeconds: 38 * 60, date: daysAgo(10) },
    ];
    const raceResult: RunSample = {
      distanceKm: 21.1,
      durationSeconds: 95 * 60,
      date: daysAgo(3),
    };
    const estimate = estimateCurrentFitness(runs, NOW, FITNESS_WINDOW_DAYS, raceResult);
    expect(estimate).not.toBeNull();
    expect(estimate!.source.isRaceResult).toBe(true);
    expect(estimate!.source.distanceKey).toBe("race");
    const expected = calculateVdot(21.1 * 1000, 95 * 60).vdot;
    expect(estimate!.vdot).toBeCloseTo(expected, 5);
  });

  it("uses the race result even when it implies a lower VDOT than a training run", () => {
    const runs: RunSample[] = [
      { distanceKm: 5, durationSeconds: 18 * 60, date: daysAgo(5) }, // very fast 5k
    ];
    const raceResult: RunSample = {
      distanceKm: 42.2,
      durationSeconds: 4 * 60 * 60,
      date: daysAgo(2),
    };
    const trainingOnly = estimateCurrentFitness(runs, NOW);
    const withRace = estimateCurrentFitness(runs, NOW, FITNESS_WINDOW_DAYS, raceResult);
    expect(withRace!.source.isRaceResult).toBe(true);
    // The race's implied VDOT is lower than the training 5k's, but it still wins.
    expect(withRace!.vdot).toBeLessThan(trainingOnly!.vdot);
  });

  it("falls back to training runs when the race result is outside the recency window", () => {
    const runs: RunSample[] = [
      { distanceKm: 10, durationSeconds: 45 * 60, date: daysAgo(10) },
    ];
    const staleRace: RunSample = {
      distanceKm: 21.1,
      durationSeconds: 95 * 60,
      date: daysAgo(FITNESS_WINDOW_DAYS + 5),
    };
    const estimate = estimateCurrentFitness(runs, NOW, FITNESS_WINDOW_DAYS, staleRace);
    expect(estimate!.source.isRaceResult).toBe(false);
    expect(estimate!.source.distanceKey).toBe("10k");
  });

  it("ignores a null race result and behaves like the plain estimator", () => {
    const runs: RunSample[] = [
      { distanceKm: 10, durationSeconds: 45 * 60, date: daysAgo(10) },
    ];
    const withNull = estimateCurrentFitness(runs, NOW, FITNESS_WINDOW_DAYS, null);
    const plain = estimateCurrentFitness(runs, NOW);
    expect(withNull!.vdot).toBeCloseTo(plain!.vdot, 10);
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
