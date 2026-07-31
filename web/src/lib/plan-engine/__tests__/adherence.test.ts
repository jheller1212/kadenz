import { describe, it, expect } from "vitest";
import { detectBehindPlan, ADHERENCE_WINDOW_DAYS } from "../adherence";

const NOW = new Date("2026-07-27T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("detectBehindPlan", () => {
  it("is not behind with too few considered sessions, even if all were missed", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "missed", type: "easy" },
        { date: daysAgo(3), status: "missed", type: "easy" },
      ],
      NOW
    );
    expect(result.behind).toBe(false);
    expect(result.consideredCount).toBe(2);
  });

  it("is behind when most recent scheduled sessions were missed", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "missed", type: "easy" },
        { date: daysAgo(3), status: "missed", type: "long" },
        { date: daysAgo(5), status: "missed", type: "tempo" },
        { date: daysAgo(8), status: "completed", type: "easy" },
        { date: daysAgo(10), status: "completed", type: "easy" },
      ],
      NOW
    );
    expect(result.behind).toBe(true);
    expect(result.missedCount).toBe(3);
    expect(result.consideredCount).toBe(5);
  });

  it("is not behind when most recent sessions were completed", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "completed", type: "easy" },
        { date: daysAgo(3), status: "completed", type: "long" },
        { date: daysAgo(5), status: "completed", type: "tempo" },
        { date: daysAgo(8), status: "missed", type: "easy" },
      ],
      NOW
    );
    expect(result.behind).toBe(false);
  });

  it("treats a still-planned, past-due session as missed", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "planned", type: "easy" },
        { date: daysAgo(3), status: "planned", type: "long" },
        { date: daysAgo(5), status: "planned", type: "tempo" },
        { date: daysAgo(8), status: "completed", type: "easy" },
      ],
      NOW
    );
    expect(result.behind).toBe(true);
    expect(result.missedCount).toBe(3);
  });

  it("excludes an explicit skip from both the numerator and denominator", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "skipped", type: "easy" },
        { date: daysAgo(3), status: "skipped", type: "long" },
        { date: daysAgo(5), status: "skipped", type: "tempo" },
        { date: daysAgo(8), status: "completed", type: "easy" },
        { date: daysAgo(10), status: "completed", type: "easy" },
      ],
      NOW
    );
    expect(result.behind).toBe(false);
    expect(result.consideredCount).toBe(2);
  });

  it("excludes rest days", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(1), status: "missed", type: "rest" },
        { date: daysAgo(3), status: "missed", type: "rest" },
        { date: daysAgo(5), status: "missed", type: "rest" },
        { date: daysAgo(8), status: "completed", type: "easy" },
      ],
      NOW
    );
    expect(result.consideredCount).toBe(1);
    expect(result.behind).toBe(false);
  });

  it("ignores sessions outside the rolling window", () => {
    const result = detectBehindPlan(
      [
        { date: daysAgo(ADHERENCE_WINDOW_DAYS + 5), status: "missed", type: "easy" },
        { date: daysAgo(ADHERENCE_WINDOW_DAYS + 6), status: "missed", type: "easy" },
        { date: daysAgo(ADHERENCE_WINDOW_DAYS + 7), status: "missed", type: "easy" },
        { date: daysAgo(1), status: "completed", type: "easy" },
      ],
      NOW
    );
    expect(result.consideredCount).toBe(1);
    expect(result.behind).toBe(false);
  });
});
