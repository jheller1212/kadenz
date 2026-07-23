import { describe, it, expect } from "vitest";
import { fuelingAdvice, shouldShowFueling } from "../fueling";

describe("fuelingAdvice", () => {
  it("returns null for short sessions", () => {
    expect(fuelingAdvice(30, "easy")).toBeNull();
    expect(fuelingAdvice(44, "easy")).toBeNull();
  });

  it("scales carbs/hour with duration", () => {
    expect(fuelingAdvice(50, "easy")!.carbsPerHour).toBe(0);
    expect(fuelingAdvice(75, "long")!.carbsPerHour).toBe(30);
    expect(fuelingAdvice(120, "long")!.carbsPerHour).toBe(60);
    expect(fuelingAdvice(180, "race")!.carbsPerHour).toBe(90);
  });

  it("computes a sane total and hydration", () => {
    const a = fuelingAdvice(120, "long")!;
    expect(a.totalCarbsG).toBe(120); // 60 g/h × 2 h
    expect(a.hydrationMlPerHour).toBe(600);
    const short = fuelingAdvice(60, "long")!;
    expect(short.hydrationMlPerHour).toBe(500);
  });

  it("shows a race-day checklist only for races", () => {
    expect(fuelingAdvice(120, "race")!.showChecklist).toBe(true);
    expect(fuelingAdvice(120, "long")!.showChecklist).toBe(false);
    expect(fuelingAdvice(120, "race")!.tips.some((t) => /nothing new/i.test(t))).toBe(true);
  });
});

describe("shouldShowFueling", () => {
  it("shows for race/long and long-enough sessions", () => {
    expect(shouldShowFueling("race", 30)).toBe(true);
    expect(shouldShowFueling("long", 40)).toBe(true);
    expect(shouldShowFueling("easy", 95)).toBe(true);
    expect(shouldShowFueling("easy", 40)).toBe(false);
    expect(shouldShowFueling("easy", null)).toBe(false);
  });
});
