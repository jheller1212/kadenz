import { describe, expect, it } from "vitest";
import { computeReadiness, type ReadinessInput } from "../readiness";

function base(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    wellness: {
      ageHours: 2,
      energy: 3,
      sleepQuality: 3,
      soreness: 2,
      illness: false,
      injury: false,
    },
    maxRecentPain: null,
    recentStrengthRpe: null,
    last7DaysKm: 30,
    priorWeeklyAvgKm: 30,
    ...overrides,
  };
}

describe("computeReadiness", () => {
  it("neutral check-in lands in the ready band", () => {
    const r = computeReadiness(base());
    expect(r.band).toBe("ready");
    expect(r.score).toBe(75);
    expect(r.hasCheckIn).toBe(true);
  });

  it("great check-in scores higher than neutral", () => {
    const r = computeReadiness(
      base({ wellness: { ageHours: 2, energy: 5, sleepQuality: 5, soreness: 1, illness: false, injury: false } })
    );
    expect(r.score).toBeGreaterThan(75);
    expect(r.band).toBe("ready");
  });

  it("bad sleep + high soreness drops to easy", () => {
    const r = computeReadiness(
      base({ wellness: { ageHours: 2, energy: 3, sleepQuality: 1, soreness: 4, illness: false, injury: false } })
    );
    expect(r.band).toBe("easy");
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("illness caps the score into the rest band regardless of other signals", () => {
    const r = computeReadiness(
      base({ wellness: { ageHours: 2, energy: 5, sleepQuality: 5, soreness: 1, illness: true, injury: false } })
    );
    expect(r.score).toBeLessThanOrEqual(25);
    expect(r.band).toBe("rest");
  });

  it("injury caps below ready", () => {
    const r = computeReadiness(
      base({ wellness: { ageHours: 2, energy: 5, sleepQuality: 5, soreness: 1, illness: false, injury: true } })
    );
    expect(r.score).toBeLessThanOrEqual(35);
  });

  it("pain flag and hard strength session subtract", () => {
    const neutral = computeReadiness(base());
    const strained = computeReadiness(base({ maxRecentPain: 6, recentStrengthRpe: 9 }));
    expect(strained.score).toBe(neutral.score - 25);
  });

  it("load spike subtracts only with a meaningful base", () => {
    const spiked = computeReadiness(base({ last7DaysKm: 50, priorWeeklyAvgKm: 30 }));
    expect(spiked.reasons.some((r) => r.label.includes("Load spike"))).toBe(true);
    const newRunner = computeReadiness(base({ last7DaysKm: 8, priorWeeklyAvgKm: 2 }));
    expect(newRunner.reasons.some((r) => r.label.includes("Load spike"))).toBe(false);
  });

  it("no check-in still scores from load, flagged as missing", () => {
    const r = computeReadiness(base({ wellness: null }));
    expect(r.hasCheckIn).toBe(false);
    expect(r.score).toBe(75);
  });

  it("stale check-in (>30h) is used for scoring but flagged", () => {
    const r = computeReadiness(
      base({ wellness: { ageHours: 40, energy: 1, sleepQuality: 1, soreness: 5, illness: false, injury: false } })
    );
    expect(r.hasCheckIn).toBe(false);
    expect(r.band).toBe("rest");
  });

  it("score is clamped to 0..100", () => {
    const r = computeReadiness(
      base({
        wellness: { ageHours: 2, energy: 1, sleepQuality: 1, soreness: 5, illness: false, injury: false },
        maxRecentPain: 8,
        recentStrengthRpe: 10,
        last7DaysKm: 80,
        priorWeeklyAvgKm: 30,
      })
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.band).toBe("rest");
  });
});
