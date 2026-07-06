import { describe, expect, it } from "vitest";
import {
  DUMBBELL_LEVELS_KG,
  weightForLevel,
  levelForWeight,
  snapToLevel,
  nextWeight,
  prevWeight,
  isTopLevel,
  MAX_LEVEL,
} from "../weights";

describe("dumbbell ladder", () => {
  it("has 18 levels (DH FitLife 18-in-1)", () => {
    expect(DUMBBELL_LEVELS_KG).toHaveLength(18);
    expect(DUMBBELL_LEVELS_KG[0]).toBe(2.5);
    expect(DUMBBELL_LEVELS_KG[MAX_LEVEL]).toBe(23.5);
  });

  it("clamps level lookups to the ladder", () => {
    expect(weightForLevel(-5)).toBe(2.5);
    expect(weightForLevel(999)).toBe(23.5);
  });

  it("snaps arbitrary weights to the nearest real stop", () => {
    expect(snapToLevel(7.5)).toBe(8); // between 6.5 and 8, closer to 8
    expect(snapToLevel(10)).toBe(10.5); // between 9 and 10.5, closer to 10.5
    expect(snapToLevel(25)).toBe(23.5); // above ceiling → clamps
    expect(snapToLevel(2)).toBe(2.5);
  });

  it("ties snap down to the lighter level", () => {
    // 12.5 is exactly between 12 and 13
    expect(snapToLevel(12.5)).toBe(12);
  });

  it("steps one level up and down along the real (non-uniform) ladder", () => {
    expect(nextWeight(8)).toBe(9);
    expect(nextWeight(9)).toBe(10.5);
    expect(prevWeight(10.5)).toBe(9);
    expect(prevWeight(2.5)).toBe(2.5); // floor
    expect(nextWeight(23.5)).toBe(23.5); // ceiling
  });

  it("identifies the ceiling", () => {
    expect(isTopLevel(23.5)).toBe(true);
    expect(isTopLevel(23)).toBe(false);
    expect(levelForWeight(23.5)).toBe(MAX_LEVEL);
  });
});
