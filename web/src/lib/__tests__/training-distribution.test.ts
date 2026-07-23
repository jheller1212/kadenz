import { describe, it, expect } from "vitest";
import {
  collapseToThreeZones,
  bandPercents,
  polarizationIndex,
  classifyDistribution,
} from "../training-distribution";

// Zones expressed in minutes (×60 → seconds) for readability.
const z = (z1: number, z2: number, z3: number, z4: number, z5: number) =>
  [z1, z2, z3, z4, z5].map((m) => m * 60);

describe("collapseToThreeZones", () => {
  it("maps Z1+Z2 → low, Z3+Z4 → moderate, Z5 → high", () => {
    const r = collapseToThreeZones(z(30, 50, 10, 5, 5));
    expect(r.low).toBe((30 + 50) * 60);
    expect(r.moderate).toBe((10 + 5) * 60);
    expect(r.high).toBe(5 * 60);
    expect(r.total).toBe(100 * 60);
  });

  it("tolerates short/empty arrays", () => {
    expect(collapseToThreeZones([]).total).toBe(0);
    expect(collapseToThreeZones([600, 600]).moderate).toBe(0);
  });
});

describe("bandPercents", () => {
  it("returns whole-percent shares", () => {
    const r = bandPercents(collapseToThreeZones(z(40, 40, 5, 5, 10)));
    expect(r).toEqual({ low: 80, moderate: 10, high: 10 });
  });
  it("is zeroed with no data", () => {
    expect(bandPercents({ low: 0, moderate: 0, high: 0, total: 0 })).toEqual({
      low: 0,
      moderate: 0,
      high: 0,
    });
  });
});

describe("polarizationIndex (Treff 2019)", () => {
  it("exceeds 2.00 for a polarized split (80/5/15)", () => {
    const pi = polarizationIndex(collapseToThreeZones(z(40, 40, 3, 2, 15)));
    // log10(0.8/0.05 * 0.15 * 100) = log10(240) ≈ 2.38
    expect(pi).not.toBeNull();
    expect(pi!).toBeGreaterThan(2);
    expect(pi!).toBeCloseTo(2.38, 1);
  });

  it("is ≤ 2.00 when moderate equals high (80/10/10, non-polarized)", () => {
    const pi = polarizationIndex(collapseToThreeZones(z(40, 40, 5, 5, 10)));
    // log10(0.8*100) = 1.90
    expect(pi!).toBeLessThan(2);
    expect(pi!).toBeCloseTo(1.9, 1);
  });

  it("is null with no high-intensity time", () => {
    expect(polarizationIndex(collapseToThreeZones(z(50, 40, 5, 5, 0)))).toBeNull();
  });

  it("is null with no data", () => {
    expect(polarizationIndex({ low: 0, moderate: 0, high: 0, total: 0 })).toBeNull();
  });

  it("handles zero moderate without dividing by zero", () => {
    const pi = polarizationIndex(collapseToThreeZones(z(45, 45, 0, 0, 10)));
    expect(pi).not.toBeNull();
    expect(Number.isFinite(pi!)).toBe(true);
  });
});

describe("classifyDistribution", () => {
  it("polarized: hard > moderate and easy > moderate (80/5/15)", () => {
    expect(classifyDistribution(collapseToThreeZones(z(40, 40, 3, 2, 15))!)!.type).toBe(
      "polarized"
    );
  });

  it("pyramidal: descending easy>moderate>hard (60/25/15)", () => {
    expect(classifyDistribution(collapseToThreeZones(z(30, 30, 13, 12, 15))!)!.type).toBe(
      "pyramidal"
    );
  });

  it("base: almost all easy, minimal intensity (95/3/2)", () => {
    expect(classifyDistribution(collapseToThreeZones(z(50, 45, 2, 1, 2))!)!.type).toBe("base");
  });

  it("high-intensity when hard dominates (50/10/40)", () => {
    expect(classifyDistribution(collapseToThreeZones(z(25, 25, 5, 5, 40))!)!.type).toBe("hiit");
  });

  it("threshold when moderate is emphasized (70/20/10)", () => {
    expect(classifyDistribution(collapseToThreeZones(z(35, 35, 10, 10, 10))!)!.type).toBe(
      "threshold"
    );
  });

  it("returns null with no data", () => {
    expect(classifyDistribution({ low: 0, moderate: 0, high: 0, total: 0 })).toBeNull();
  });
});
