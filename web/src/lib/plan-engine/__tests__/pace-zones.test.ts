import { describe, expect, it } from "vitest";
import { formatPace, getPaceZones } from "../pace-zones";

describe("getPaceZones", () => {
  it("throws for non-positive VDOT", () => {
    expect(() => getPaceZones(0)).toThrow();
    expect(() => getPaceZones(-5)).toThrow();
  });

  it("returns all five zones", () => {
    const zones = getPaceZones(50);
    expect(zones).toHaveProperty("E");
    expect(zones).toHaveProperty("M");
    expect(zones).toHaveProperty("T");
    expect(zones).toHaveProperty("I");
    expect(zones).toHaveProperty("R");
  });

  it("each zone has min <= target <= max (pace numbers)", () => {
    const zones = getPaceZones(50);
    for (const z of Object.values(zones)) {
      expect(z.minPaceSecKm).toBeLessThanOrEqual(z.targetPaceSecKm);
      expect(z.targetPaceSecKm).toBeLessThanOrEqual(z.maxPaceSecKm);
    }
  });

  // Property: zones are ordered E (slowest) > M > T > I > R (fastest) by target pace
  it("zones are ordered slowest to fastest by target pace", () => {
    const zones = getPaceZones(55);
    expect(zones.E.targetPaceSecKm).toBeGreaterThan(zones.M.targetPaceSecKm);
    expect(zones.M.targetPaceSecKm).toBeGreaterThan(zones.T.targetPaceSecKm);
    expect(zones.T.targetPaceSecKm).toBeGreaterThan(zones.I.targetPaceSecKm);
    expect(zones.I.targetPaceSecKm).toBeGreaterThan(zones.R.targetPaceSecKm);
  });

  // Property: higher VDOT → faster (lower) paces
  it("higher VDOT produces faster paces", () => {
    const low = getPaceZones(40);
    const high = getPaceZones(60);
    expect(high.E.targetPaceSecKm).toBeLessThan(low.E.targetPaceSecKm);
    expect(high.T.targetPaceSecKm).toBeLessThan(low.T.targetPaceSecKm);
    expect(high.I.targetPaceSecKm).toBeLessThan(low.I.targetPaceSecKm);
  });

  it("Easy zone pace is sensible for VDOT 50 (roughly 5:00–6:30 /km)", () => {
    const zones = getPaceZones(50);
    // 5:00 = 300 sec, 6:30 = 390 sec
    expect(zones.E.targetPaceSecKm).toBeGreaterThan(300);
    expect(zones.E.targetPaceSecKm).toBeLessThan(390);
  });

  it("all paces are positive integers", () => {
    const zones = getPaceZones(45);
    for (const z of Object.values(zones)) {
      expect(z.minPaceSecKm).toBeGreaterThan(0);
      expect(z.targetPaceSecKm).toBeGreaterThan(0);
      expect(z.maxPaceSecKm).toBeGreaterThan(0);
      expect(Number.isInteger(z.minPaceSecKm)).toBe(true);
      expect(Number.isInteger(z.targetPaceSecKm)).toBe(true);
      expect(Number.isInteger(z.maxPaceSecKm)).toBe(true);
    }
  });
});

describe("formatPace", () => {
  it("formats 300 sec/km as 5:00", () => {
    expect(formatPace(300)).toBe("5:00");
  });

  it("formats 330 sec/km as 5:30", () => {
    expect(formatPace(330)).toBe("5:30");
  });

  it("pads seconds with leading zero", () => {
    expect(formatPace(361)).toBe("6:01");
  });
});
