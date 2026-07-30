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
    physiology: null,
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

  it("hard run effort subtracts; moderate runs don't", () => {
    const neutral = computeReadiness(base());
    const hardRun = computeReadiness(base({ recentRunRpe: 9 }));
    expect(hardRun.score).toBe(neutral.score - 8);
    expect(hardRun.reasons.some((r) => r.label === "Hard run effort")).toBe(true);
    const moderate = computeReadiness(base({ recentRunRpe: 6 }));
    expect(moderate.score).toBe(neutral.score);
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

  it("physiology in warm-up contributes nothing but is surfaced for the card", () => {
    const r = computeReadiness(
      base({
        physiology: { delta: 0, reasons: [], ready: false, warmup: { daysCollected: 5, daysNeeded: 21 }, source: "garmin" },
      })
    );
    expect(r.score).toBe(75);
    expect(r.reasons).toEqual([]);
    expect(r.physiologyWarmup).toEqual({ daysCollected: 5, daysNeeded: 21 });
  });

  it("no device connected: warm-up is not surfaced, so nobody waits forever", () => {
    // An athlete who told us they have no device collects zero of the 21
    // nights the baseline needs. Showing "building your baseline (5/21)" from
    // stale rows would promise a number that can never arrive.
    const r = computeReadiness(
      base({
        expectsPhysiology: false,
        physiology: { delta: 0, reasons: [], ready: false, warmup: { daysCollected: 5, daysNeeded: 21 }, source: "garmin" },
      })
    );
    expect(r.physiologyWarmup).toBeNull();
    expect(r.score).toBe(75);
    // And the source goes quiet with it. Naming Garmin while withholding its
    // contribution would read as "recovery data from Garmin" to someone who
    // has no Garmin, which is how stale rows turn into a false claim.
    expect(r.physiologySource).toBeNull();
  });

  it("no device connected: physiology that did become ready still counts", () => {
    // Suppression is about not advertising data that is not coming, not about
    // discarding data that arrived.
    const r = computeReadiness(
      base({
        expectsPhysiology: false,
        physiology: {
          delta: -12,
          reasons: [{ label: "HRV 20% below your baseline", delta: -12 }],
          ready: true,
          warmup: null,
          source: "garmin",
        },
      })
    );
    expect(r.score).toBe(63);
    expect(r.physiologyWarmup).toBeNull();
  });

  it("ready physiology folds its reasons and delta into the score", () => {
    const r = computeReadiness(
      base({
        physiology: {
          delta: -12,
          reasons: [{ label: "HRV 20% below your baseline", delta: -12 }],
          ready: true,
          warmup: null,
          source: "garmin",
        },
      })
    );
    expect(r.score).toBe(63);
    expect(r.reasons.some((x) => x.label.includes("HRV"))).toBe(true);
    expect(r.physiologyWarmup).toBeNull();
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
