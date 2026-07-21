import { describe, expect, it } from "vitest";
import { garminLabel, planWeekNumber } from "../garmin-label";

describe("planWeekNumber", () => {
  const start = new Date("2026-01-05T00:00:00Z"); // a Monday
  it("is week 1 on the start date", () => {
    expect(planWeekNumber(new Date("2026-01-05T12:00:00Z"), start)).toBe(1);
  });
  it("is week 1 at day 6, week 2 at day 7", () => {
    expect(planWeekNumber(new Date("2026-01-11T00:00:00Z"), start)).toBe(1);
    expect(planWeekNumber(new Date("2026-01-12T00:00:00Z"), start)).toBe(2);
  });
  it("clamps pre-start dates to week 1", () => {
    expect(planWeekNumber(new Date("2025-12-01T00:00:00Z"), start)).toBe(1);
  });
});

describe("garminLabel", () => {
  it("prefixes the week", () => {
    expect(garminLabel("Easy Run 10km", { weekNumber: 3 })).toBe("W3 · Easy Run 10km");
  });
  it("appends a metric", () => {
    expect(garminLabel("Upper — Kraft", { weekNumber: 2, metric: "30 min" })).toBe(
      "W2 · Upper — Kraft · 30 min"
    );
  });
  it("omits the week when absent (standalone block)", () => {
    expect(garminLabel("Upper — Kraft", { metric: "30 min" })).toBe("Upper — Kraft · 30 min");
    expect(garminLabel("Easy Run 10km")).toBe("Easy Run 10km");
  });
});
