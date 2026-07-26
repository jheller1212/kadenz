import { describe, expect, it } from "vitest";
import { deriveWarmupRamp, WARMUP_THRESHOLD_KG, RAMP_TWO_STEP_KG, RAMP_REPS } from "../warmup";

describe("deriveWarmupRamp", () => {
  it("gives no ramp to accessory work, even if heavy", () => {
    expect(deriveWarmupRamp("accessory", 25)).toEqual([]);
  });

  it("gives no ramp to Achilles/rehab work, even if heavy", () => {
    expect(deriveWarmupRamp("achilles", 25)).toEqual([]);
  });

  it("gives no ramp to targeted complaint work, even if heavy", () => {
    expect(deriveWarmupRamp("targeted", 25)).toEqual([]);
  });

  it("gives no ramp to a bodyweight exercise (no working weight)", () => {
    expect(deriveWarmupRamp("primary", null)).toEqual([]);
    expect(deriveWarmupRamp("primary", undefined)).toEqual([]);
  });

  it("gives no ramp below the threshold, even for a primary lift", () => {
    expect(deriveWarmupRamp("primary", WARMUP_THRESHOLD_KG - 0.5)).toEqual([]);
  });

  it("gives one ramp set at 60% for a moderately heavy primary lift", () => {
    const ramp = deriveWarmupRamp("primary", WARMUP_THRESHOLD_KG);
    expect(ramp).toHaveLength(1);
    expect(ramp[0].kg).toBeLessThan(WARMUP_THRESHOLD_KG);
    expect(ramp[0].reps).toBe(RAMP_REPS);
  });

  it("gives two ramp sets at 50% and 75% for a heavy primary lift", () => {
    const ramp = deriveWarmupRamp("primary", RAMP_TWO_STEP_KG);
    expect(ramp).toHaveLength(2);
    expect(ramp[0].kg).toBeLessThan(ramp[1].kg);
    expect(ramp[1].kg).toBeLessThan(RAMP_TWO_STEP_KG);
  });

  it("never suggests a ramp set at or above the working weight", () => {
    for (const w of [10, 12.5, 15, 17.5, 20, 25, 30]) {
      const ramp = deriveWarmupRamp("primary", w);
      for (const r of ramp) expect(r.kg).toBeLessThan(w);
    }
  });

  it("snaps ramp weights onto the real dumbbell ladder", () => {
    // 12.5 * 0.6 = 7.5, already a real level; just confirms no fractional
    // off-ladder weight leaks out.
    const ramp = deriveWarmupRamp("primary", 12.5);
    expect(ramp[0].kg).toBe(7.5);
  });
});
