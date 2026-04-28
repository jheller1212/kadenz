import { describe, expect, it } from "vitest";
import {
  calculateVdot,
  pctVO2maxAtDuration,
  predictRaceTime,
  RACE_DISTANCES_M,
} from "../vdot";

describe("pctVO2maxAtDuration", () => {
  it("approaches 0.8 for very long durations", () => {
    // As t → ∞, exp terms → 0, so result approaches 0.8
    const result = pctVO2maxAtDuration(500);
    expect(result).toBeCloseTo(0.8, 2);
  });

  it("is greater than 0.8 for shorter races", () => {
    expect(pctVO2maxAtDuration(10)).toBeGreaterThan(0.8);
    expect(pctVO2maxAtDuration(60)).toBeGreaterThan(0.8);
  });

  it("is monotonically decreasing with duration", () => {
    const durations = [5, 10, 20, 40, 60, 120, 240];
    for (let i = 1; i < durations.length; i++) {
      expect(pctVO2maxAtDuration(durations[i])).toBeLessThan(
        pctVO2maxAtDuration(durations[i - 1])
      );
    }
  });
});

describe("calculateVdot", () => {
  // Reference values from Daniels' Running Formula tables
  // 5k in 21:00 ≈ VDOT 47 per Daniels' tables
  it("gives ~47 VDOT for 5k in ~21:00", () => {
    const { vdot } = calculateVdot(RACE_DISTANCES_M["5k"], 21 * 60);
    expect(vdot).toBeGreaterThan(45);
    expect(vdot).toBeLessThan(49);
  });

  // Marathon in 3:10 (190 min) ≈ VDOT 50
  it("gives ~50 VDOT for marathon in ~3:10 (190 min)", () => {
    const { vdot } = calculateVdot(RACE_DISTANCES_M.marathon, 190 * 60);
    expect(vdot).toBeGreaterThan(48);
    expect(vdot).toBeLessThan(53);
  });

  it("throws for zero distance", () => {
    expect(() => calculateVdot(0, 1200)).toThrow();
  });

  it("throws for zero time", () => {
    expect(() => calculateVdot(5000, 0)).toThrow();
  });

  // Property: faster time → higher VDOT
  it("faster 10k time produces higher VDOT", () => {
    const slow = calculateVdot(RACE_DISTANCES_M["10k"], 60 * 60).vdot;
    const fast = calculateVdot(RACE_DISTANCES_M["10k"], 40 * 60).vdot;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe("predictRaceTime", () => {
  it("round-trips: calculateVdot → predictRaceTime recovers original time", () => {
    const distanceM = RACE_DISTANCES_M["10k"];
    const originalSeconds = 45 * 60; // 45 min 10k
    const { vdot } = calculateVdot(distanceM, originalSeconds);
    const predicted = predictRaceTime(vdot, distanceM);
    expect(predicted).toBeCloseTo(originalSeconds, -1); // within ~10 seconds
  });

  it("marathon prediction from 5k VDOT is slower than half", () => {
    const { vdot } = calculateVdot(RACE_DISTANCES_M["5k"], 20 * 60);
    const halfTime = predictRaceTime(vdot, RACE_DISTANCES_M.half);
    const marathonTime = predictRaceTime(vdot, RACE_DISTANCES_M.marathon);
    expect(marathonTime).toBeGreaterThan(halfTime);
  });

  it("throws for non-positive inputs", () => {
    expect(() => predictRaceTime(0, 5000)).toThrow();
    expect(() => predictRaceTime(50, 0)).toThrow();
  });

  // Property: higher VDOT → faster predicted time
  it("higher VDOT predicts faster time for same distance", () => {
    const slow = predictRaceTime(40, RACE_DISTANCES_M.marathon);
    const fast = predictRaceTime(60, RACE_DISTANCES_M.marathon);
    expect(fast).toBeLessThan(slow);
  });
});
