import { describe, expect, it } from "vitest";
import { accurateFix, haversine, isPlausibleDelta } from "../gps";

describe("accurateFix", () => {
  it("accepts a fix with no accuracy reported", () => {
    expect(accurateFix({ accuracy: null as unknown as number })).toBe(true);
  });

  it("accepts a fix under the 35m threshold", () => {
    expect(accurateFix({ accuracy: 20 })).toBe(true);
  });

  it("rejects a fix at or over the 35m threshold", () => {
    expect(accurateFix({ accuracy: 35 })).toBe(false);
    expect(accurateFix({ accuracy: 100 })).toBe(false);
  });
});

describe("isPlausibleDelta", () => {
  it("rejects deltas at or below the GPS noise floor", () => {
    expect(isPlausibleDelta(1, 2000)).toBe(false);
    expect(isPlausibleDelta(0.5, 2000)).toBe(false);
  });

  it("accepts a normal jog-paced delta over a short gap", () => {
    // ~4.5 m/s for 2s = 9m, well inside the default 60m bound.
    expect(isPlausibleDelta(9, 2000)).toBe(true);
  });

  it("rejects a teleport-sized jump over a short gap", () => {
    expect(isPlausibleDelta(200, 2000)).toBe(false);
  });

  it("widens the bound after a long poor-signal gap so real ground isn't dropped", () => {
    // 40s poor-signal stretch at a plausible running pace: legitimately
    // covers more than the fixed 60m cap before the next accurate fix.
    const elapsedMs = 40_000;
    const distanceM = 150; // ~3.75 m/s average, well under MAX_PLAUSIBLE_SPEED_MPS
    expect(isPlausibleDelta(distanceM, elapsedMs)).toBe(true);
  });

  it("still rejects an implausible jump even after a long gap", () => {
    // No human runs 2km in 40s.
    expect(isPlausibleDelta(2000, 40_000)).toBe(false);
  });

  it("keeps the fixed 60m floor for very short gaps regardless of speed math", () => {
    // elapsedMs is tiny, so the speed-based bound would be near-zero; the
    // 60m floor must still apply so a normal fix isn't rejected.
    expect(isPlausibleDelta(50, 1)).toBe(true);
  });
});

describe("haversine", () => {
  it("returns 0 for identical points", () => {
    const a = { latitude: 50.85, longitude: 5.69 } as GeolocationCoordinates;
    expect(haversine(a, a)).toBeCloseTo(0, 5);
  });

  it("returns a sane distance for a small known offset", () => {
    const a = { latitude: 50.85, longitude: 5.69 } as GeolocationCoordinates;
    const b = { latitude: 50.8509, longitude: 5.69 } as GeolocationCoordinates;
    // ~0.0009 deg lat ~= 100m
    expect(haversine(a, b)).toBeGreaterThan(90);
    expect(haversine(a, b)).toBeLessThan(110);
  });
});
