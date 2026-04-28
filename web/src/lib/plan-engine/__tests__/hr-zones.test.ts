import { describe, expect, it } from "vitest";
import { estimateMaxHr, getHrZones } from "../hr-zones";

describe("estimateMaxHr", () => {
  it("uses Tanaka formula: 208 - 0.7*age", () => {
    expect(estimateMaxHr(30)).toBe(187); // 208 - 21
    expect(estimateMaxHr(40)).toBe(180); // 208 - 28
    expect(estimateMaxHr(50)).toBe(173); // 208 - 35
  });

  it("throws for non-positive age", () => {
    expect(() => estimateMaxHr(0)).toThrow();
    expect(() => estimateMaxHr(-1)).toThrow();
  });

  // Property: older age → lower max HR
  it("is monotonically decreasing with age", () => {
    const ages = [20, 30, 40, 50, 60, 70];
    for (let i = 1; i < ages.length; i++) {
      expect(estimateMaxHr(ages[i])).toBeLessThan(estimateMaxHr(ages[i - 1]));
    }
  });
});

describe("getHrZones", () => {
  const BASE_PARAMS = { restingHr: 50, age: 35 };

  it("throws when restingHr is not positive", () => {
    expect(() => getHrZones(0, 35)).toThrow();
  });

  it("throws when maxHr <= restingHr", () => {
    expect(() => getHrZones(60, 35, 55)).toThrow();
  });

  it("returns five zones", () => {
    const zones = getHrZones(BASE_PARAMS.restingHr, BASE_PARAMS.age);
    expect(zones).toHaveProperty("z1");
    expect(zones).toHaveProperty("z2");
    expect(zones).toHaveProperty("z3");
    expect(zones).toHaveProperty("z4");
    expect(zones).toHaveProperty("z5");
  });

  it("zones are contiguous (z1.max === z2.min, etc.)", () => {
    const zones = getHrZones(50, 35);
    expect(zones.z1.max).toBe(zones.z2.min);
    expect(zones.z2.max).toBe(zones.z3.min);
    expect(zones.z3.max).toBe(zones.z4.min);
    expect(zones.z4.max).toBe(zones.z5.min);
  });

  it("z5.max equals max HR", () => {
    const maxHr = 185;
    const zones = getHrZones(50, 35, maxHr);
    expect(zones.z5.max).toBe(maxHr);
  });

  it("uses provided maxHr instead of estimated value", () => {
    const measuredMaxHr = 195;
    const zones = getHrZones(50, 35, measuredMaxHr);
    expect(zones.z5.max).toBe(measuredMaxHr);
  });

  // Property: higher resting HR → higher zone min/max values
  it("higher resting HR raises all zone values", () => {
    const lo = getHrZones(45, 35);
    const hi = getHrZones(65, 35);
    expect(hi.z1.min).toBeGreaterThan(lo.z1.min);
    expect(hi.z3.min).toBeGreaterThan(lo.z3.min);
  });

  it("all zone values are positive integers", () => {
    const zones = getHrZones(55, 40);
    for (const z of Object.values(zones)) {
      expect(z.min).toBeGreaterThan(0);
      expect(z.max).toBeGreaterThan(0);
      expect(Number.isInteger(z.min)).toBe(true);
      expect(Number.isInteger(z.max)).toBe(true);
    }
  });
});
