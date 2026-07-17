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

describe("standard weight ladder", () => {
  it("runs 1-25 kg in 0.5 steps, then 26-50 kg in 1 kg steps", () => {
    // 1..25 in 0.5 steps = 49 stops, 26..50 in 1 kg steps = 25 stops
    expect(DUMBBELL_LEVELS_KG).toHaveLength(49 + 25);
    expect(DUMBBELL_LEVELS_KG[0]).toBe(1);
    expect(DUMBBELL_LEVELS_KG).toContain(24.5);
    expect(DUMBBELL_LEVELS_KG).toContain(25);
    expect(DUMBBELL_LEVELS_KG).not.toContain(25.5);
    expect(DUMBBELL_LEVELS_KG).toContain(26);
    expect(DUMBBELL_LEVELS_KG[MAX_LEVEL]).toBe(50);
  });

  it("clamps level lookups to the ladder", () => {
    expect(weightForLevel(-5)).toBe(1);
    expect(weightForLevel(999)).toBe(50);
  });

  it("snaps arbitrary weights to the nearest stop", () => {
    expect(snapToLevel(7.6)).toBe(7.5);
    expect(snapToLevel(7.8)).toBe(8);
    expect(snapToLevel(60)).toBe(50); // above ceiling → clamps
    expect(snapToLevel(0.2)).toBe(1);
  });

  it("ties snap down to the lighter level", () => {
    // 25.5 is exactly between 25 and 26
    expect(snapToLevel(25.5)).toBe(25);
    // 7.75 is exactly between 7.5 and 8
    expect(snapToLevel(7.75)).toBe(7.5);
  });

  it("steps 0.5 kg below 25 and 1 kg above", () => {
    expect(nextWeight(8)).toBe(8.5);
    expect(prevWeight(8)).toBe(7.5);
    expect(nextWeight(25)).toBe(26);
    expect(nextWeight(30)).toBe(31);
    expect(prevWeight(26)).toBe(25);
    expect(prevWeight(1)).toBe(1); // floor
    expect(nextWeight(50)).toBe(50); // ceiling
  });

  it("identifies the ceiling", () => {
    expect(isTopLevel(50)).toBe(true);
    expect(isTopLevel(49)).toBe(false);
    expect(levelForWeight(50)).toBe(MAX_LEVEL);
  });
});
