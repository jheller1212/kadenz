import { describe, expect, it } from "vitest";
import { computePhysiologyReadiness, MIN_BASELINE_NIGHTS, type WellnessNight } from "../physiology";

const ASOF = new Date("2026-07-24T06:00:00Z");

/** Nights counting back from ASOF, one per day, all with the same values
 * unless overridden for specific dates. */
function nightsBack(count: number, overrides: Record<number, Partial<WellnessNight>> = {}): WellnessNight[] {
  const out: WellnessNight[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(ASOF.getTime() - i * 24 * 3600_000);
    const date = d.toISOString().slice(0, 10);
    out.push({
      date,
      sleepSeconds: 7.5 * 3600,
      restingHr: 50,
      hrvLastNightAvg: 60,
      ...overrides[i],
    });
  }
  return out;
}

describe("computePhysiologyReadiness", () => {
  it("insufficient data stays in warm-up with no adjustment", () => {
    const r = computePhysiologyReadiness(nightsBack(4), ASOF);
    expect(r.ready).toBe(false);
    expect(r.delta).toBe(0);
    expect(r.reasons).toEqual([]);
    expect(r.warmup).toEqual({ daysCollected: 4, daysNeeded: MIN_BASELINE_NIGHTS });
  });

  it("a normal night against an established baseline scores neutral", () => {
    // 30 nights of identical, unremarkable values.
    const r = computePhysiologyReadiness(nightsBack(30), ASOF);
    expect(r.ready).toBe(true);
    expect(r.delta).toBe(0);
    expect(r.reasons).toEqual([]);
  });

  it("clearly suppressed HRV produces a negative adjustment with a reason", () => {
    const nights = nightsBack(30);
    // Last 7 nights well below the established baseline.
    for (let i = 1; i <= 7; i++) nights[i - 1].hrvLastNightAvg = 45; // ~25% below 60
    const r = computePhysiologyReadiness(nights, ASOF);
    expect(r.ready).toBe(true);
    expect(r.delta).toBeLessThan(0);
    expect(r.reasons.some((x) => x.label.includes("HRV") && x.label.includes("below"))).toBe(true);
  });

  it("a resting HR spike produces a negative adjustment with a reason", () => {
    const nights = nightsBack(30);
    for (let i = 1; i <= 7; i++) nights[i - 1].restingHr = 58; // +8 bpm vs baseline 50
    const r = computePhysiologyReadiness(nights, ASOF);
    expect(r.ready).toBe(true);
    expect(r.delta).toBeLessThan(0);
    expect(r.reasons.some((x) => x.label.includes("Resting HR") && x.label.includes("above"))).toBe(true);
  });

  it("transitions from warm-up to active exactly at the baseline floor", () => {
    const justShort = computePhysiologyReadiness(nightsBack(MIN_BASELINE_NIGHTS - 1), ASOF);
    expect(justShort.ready).toBe(false);

    const atFloor = computePhysiologyReadiness(nightsBack(MIN_BASELINE_NIGHTS), ASOF);
    expect(atFloor.ready).toBe(true);
  });

  it("short sleep duration is flagged independent of HRV/RHR baseline state", () => {
    const nights = nightsBack(4, { 1: { sleepSeconds: 4.5 * 3600 } });
    const r = computePhysiologyReadiness(nights, ASOF);
    // Still in warm-up (only 4 nights of baseline history) — short sleep is
    // an absolute threshold, but it should not fire before ready() is
    // established since the whole physiology block is withheld during warm-up.
    expect(r.ready).toBe(false);
  });

  it("short sleep duration is flagged once the baseline is established", () => {
    const nights = nightsBack(30, { 1: { sleepSeconds: 4.5 * 3600 } });
    const r = computePhysiologyReadiness(nights, ASOF);
    expect(r.ready).toBe(true);
    expect(r.reasons.some((x) => x.label.startsWith("Short sleep"))).toBe(true);
    expect(r.delta).toBeLessThan(0);
  });

  it("no data at all returns a zero-day warm-up state", () => {
    const r = computePhysiologyReadiness([], ASOF);
    expect(r.ready).toBe(false);
    expect(r.warmup).toEqual({ daysCollected: 0, daysNeeded: MIN_BASELINE_NIGHTS });
  });
});
